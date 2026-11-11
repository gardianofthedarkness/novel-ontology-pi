"""A local embedding server: the OpenAI-compatible /v1/embeddings over a model on disk, CPU only, offline.

The v1 causality faculty's (BAAI/bge-small-zh-v1.5, cross-scene causal retrieval, 2026-10-26), brought in for the building
level's inventory search (src/world/terrain/inventory.ts, docs/v3/design.html#borrow-and-spawn §6). The connector
(src/ground/connectors/embeddings.ts) reaches it with:

    python tools/embeddings/serve.py --model <a model folder> --port 8194
    EMBEDDING_BASE_URL=http://127.0.0.1:8194/v1 EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5

It reads only files already on disk (no download), answers on 127.0.0.1 only, and bounds every request.
"""
import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.umask(0o077)
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--port', type=int, default=8194)
parser.add_argument('--name', default='BAAI/bge-small-zh-v1.5', help='the model name the server reports')
args = parser.parse_args()
torch.set_num_threads(4)
torch.set_num_interop_threads(1)
tokenizer = AutoTokenizer.from_pretrained(args.model, local_files_only=True, trust_remote_code=False)
model = AutoModel.from_pretrained(args.model, local_files_only=True, trust_remote_code=False, use_safetensors=True).eval()
mutex = threading.Lock()

@torch.inference_mode()
def encode(texts):
    segments, owners, lengths = [], [], []
    for owner, text in enumerate(texts):
        tokens = tokenizer.encode(text, add_special_tokens=False, truncation=False)
        if not tokens:
            tokens = [tokenizer.unk_token_id]
        for offset in range(0, len(tokens), 432):
            portion = tokens[offset:offset + 480]
            segments.append(tokenizer.prepare_for_model(portion, add_special_tokens=True, truncation=False, return_attention_mask=True))
            owners.append(owner)
            lengths.append(len(portion))
            if offset + 480 >= len(tokens):
                break
    pooled = np.zeros((len(texts), model.config.hidden_size), dtype=np.float32)
    weights = np.zeros(len(texts), dtype=np.float32)
    for offset in range(0, len(segments), 16):
        batch = tokenizer.pad(segments[offset:offset + 16], padding=True, return_tensors='pt')
        vectors = torch.nn.functional.normalize(model(**batch).last_hidden_state[:, 0], p=2, dim=1).cpu().numpy()
        for index, vector in enumerate(vectors):
            segment = offset + index
            pooled[owners[segment]] += vector * lengths[segment]
            weights[owners[segment]] += lengths[segment]
    pooled /= weights[:, None]
    pooled /= np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12)
    return pooled.tolist()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *arguments):
        pass

    def reply(self, status, value):
        content = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404, {'model': args.name, 'device': 'cpu', 'ready': True})

    def do_POST(self):
        if self.path != '/v1/embeddings':
            return self.reply(404, {'error': 'not_found'})
        length = int(self.headers.get('Content-Length', '0'))
        if length < 1 or length > 2 * 1024 * 1024:
            return self.reply(413, {'error': 'bounded_input_required'})
        try:
            data = json.loads(self.rfile.read(length))
            texts = data.get('input')
            if not isinstance(texts, list) or not 1 <= len(texts) <= 100 or not all(isinstance(text, str) and len(text) <= 100000 for text in texts):
                return self.reply(400, {'error': 'invalid_input'})
            with mutex:
                vectors = encode(texts)
            self.reply(200, {'data': [{'index': index, 'embedding': vector} for index, vector in enumerate(vectors)]})
        except Exception:
            self.reply(500, {'error': 'local_embedding_failed'})

print(json.dumps({'ready': True, 'port': args.port, 'model': args.name}), flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
