"""Try several Qwen-Image-Edit Spaces with the same request; keep the first that works.
usage: qwen_try.py <out.png> <prompt-file> <ref1> [ref2 ...]"""
import shutil, sys, time
from gradio_client import Client, handle_file
out, prompt_file, refs = sys.argv[1], sys.argv[2], sys.argv[3:]
prompt = open(prompt_file, encoding='utf-8').read().strip()
SPACES = ['LPX55/Qwen-Image-Edit-2511-Turbo-Lightning', 'multimodalart/Qwen-Image-Edit-Fast', 'akhaliq/Qwen-Image-Edit-2509',
          'Qwen/Qwen-Image-Edit-2509', 'kulkas2pintu/QWEN_EDIT_IMAGE', 'Qwen/Qwen-Image-Edit']
for sp in SPACES:
    t = time.time()
    try:
        c = Client(sp, verbose=False)
        info = c.view_api(print_info=False, return_format='dict')
        ep = next(iter(info['named_endpoints']))
        params = [p['parameter_name'] for p in info['named_endpoints'][ep]['parameters']]
        kw = {}
        if 'images' in params: kw['images'] = [{'image': handle_file(r), 'caption': None} for r in refs]
        elif 'image' in params: kw['image'] = handle_file(refs[0])
        elif 'input_image' in params: kw['input_image'] = handle_file(refs[0])
        kw['prompt'] = prompt
        for k, v in (('seed', 7), ('randomize_seed', False), ('rewrite_prompt', False), ('height', 1024), ('width', 640)):
            if k in params: kw[k] = v
        print('try', sp, ep, params, flush=True)
        r = c.predict(**kw, api_name=ep)
        first = r[0] if isinstance(r, (list, tuple)) else r
        if isinstance(first, list): first = first[0]
        if isinstance(first, dict): first = first.get('image', first); first = first if isinstance(first, str) else first.get('path')
        shutil.copy(first, out); print('OK', sp, round(time.time() - t), 's', out); break
    except Exception as e:
        d = {k: str(v)[:150] for k, v in vars(e).items()} if hasattr(e, '__dict__') else {}
        print('FAIL', sp, type(e).__name__, str(e)[:200], d, flush=True)
