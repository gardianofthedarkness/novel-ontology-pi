# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "torch==2.11.0", "torchvision==0.26.0", "triton==3.6.0", "pillow==12.0.0", "imageio==2.37.2", "imageio-ffmpeg==0.6.0",
#   "tqdm==4.67.1", "easydict==1.13", "opencv-python-headless==4.12.0.88", "trimesh==4.10.1", "transformers==4.57.3",
#   "zstandard==0.25.0", "kornia==0.8.2", "timm==1.0.22", "huggingface_hub", "numpy",
#   "utils3d @ git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8",
#   "flash_attn @ https://github.com/adithyaxx/flash-attention/releases/download/v2.8.3/flash_attn-2.8.3+cu13torch2.11cxx11abiTRUE-cp312-cp312-linux_x86_64.whl",
#   "flex_gemm @ https://github.com/LDYang694/Storages/releases/download/rtxpro6000/flex_gemm-1.0.0%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
#   "nvdiffrast @ https://github.com/LDYang694/Storages/releases/download/rtxpro6000/nvdiffrast-0.4.0%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
#   "nvdiffrec_render @ https://github.com/LDYang694/Storages/releases/download/rtxpro6000/nvdiffrec_render-0.0.0%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
#   "cumesh @ https://github.com/LDYang694/Storages/releases/download/rtxpro6000/cumesh-0.0.1%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
#   "o_voxel @ https://github.com/LDYang694/Storages/releases/download/rtxpro6000/o_voxel-0.0.1%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
# ]
# [tool.uv]
# extra-index-url = ["https://download.pytorch.org/whl/cu130"]
# index-strategy = "unsafe-best-match"
# ///
"""TRELLIS.2 as a Hugging Face Job: the same packages and calls as the microsoft/TRELLIS.2 Space, with no time limit on the export.
Reads IO_REPO (a private dataset), IN_FILES (comma list of pictures with a cut-out alpha), RES (512|1024|1536), FACES (export face count);
writes <name>.glb beside each picture."""
import os, sys, time, traceback
os.environ['OPENCV_IO_ENABLE_OPENEXR'] = '1'; os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'; os.environ['ATTN_BACKEND'] = 'flash_attn'
from huggingface_hub import HfApi, hf_hub_download, snapshot_download
t0 = time.time()
def say(*a): print('TJ %4d s' % (time.time() - t0), *a, flush=True)
os.system('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader')
code = snapshot_download('microsoft/TRELLIS.2', repo_type='space', allow_patterns=['trellis2/*', 'autotune_cache.json'])
os.environ['FLEX_GEMM_AUTOTUNE_CACHE_PATH'] = os.path.join(code, 'autotune_cache.json'); sys.path.insert(0, code)
import numpy as np, torch
from PIL import Image
from trellis2.pipelines import Trellis2ImageTo3DPipeline, rembg
import o_voxel
rembg.BiRefNet = lambda **k: None          # the pictures arrive cut out; the background model is never loaded
pipe = Trellis2ImageTo3DPipeline.from_pretrained('microsoft/TRELLIS.2-4B'); pipe.rembg_model = None; pipe.low_vram = False; pipe.cuda(); say('model loaded')
def prep(im):
    """the Space's own preparation: fit to 1024, crop square on the opaque part, colour times alpha"""
    s = min(1, 1024 / max(im.size))
    if s < 1: im = im.resize((int(im.width * s), int(im.height * s)), Image.Resampling.LANCZOS)
    a = np.array(im); box = np.argwhere(a[:, :, 3] > 0.8 * 255)
    x0, y0, x1, y1 = box[:, 1].min(), box[:, 0].min(), box[:, 1].max(), box[:, 0].max()
    cx, cy, size = (x0 + x1) / 2, (y0 + y1) / 2, int(max(x1 - x0, y1 - y0))
    o = np.array(im.crop((cx - size // 2, cy - size // 2, cx + size // 2, cy + size // 2))).astype(np.float32) / 255
    return Image.fromarray((o[:, :, :3] * o[:, :, 3:4] * 255).astype(np.uint8))
repo, res, faces = os.environ['IO_REPO'], os.environ.get('RES', '1024'), int(os.environ.get('FACES', '300000')); api = HfApi()
for name in os.environ['IN_FILES'].split(','):
    try:
        im = prep(Image.open(hf_hub_download(repo, name, repo_type='dataset')).convert('RGBA'))
        out, lat = pipe.run(im, seed=0, preprocess_image=False, pipeline_type={'512': '512', '1024': '1024_cascade', '1536': '1536_cascade'}[res], return_latent=True)
        mesh = out[0]; mesh.simplify(16777216); say(name, 'generated', tuple(mesh.vertices.shape), tuple(mesh.faces.shape))
        glb = o_voxel.postprocess.to_glb(vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords, attr_layout=pipe.pbr_attr_layout,
            grid_size=lat[2], aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], decimation_target=faces, texture_size=1024, remesh=True, remesh_band=1, remesh_project=0, use_tqdm=False)
        dst = os.path.splitext(name)[0] + '.glb'; glb.export('/tmp/out.glb', extension_webp=True)
        api.upload_file(path_or_fileobj='/tmp/out.glb', path_in_repo=dst, repo_id=repo, repo_type='dataset'); say(name, 'saved', dst, os.path.getsize('/tmp/out.glb'), 'bytes')
        torch.cuda.empty_cache()
    except Exception as e:
        say(name, 'FAILED', repr(e)[:300]); traceback.print_exc()
say('peak GPU memory %.1f GB' % (torch.cuda.max_memory_allocated() / 2**30))
