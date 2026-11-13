"""List running HF Spaces matching search terms (anonymous)."""
import sys
from huggingface_hub import HfApi
api = HfApi()
for term in sys.argv[1:]:
    print('==', term)
    try:
        for s in api.list_spaces(search=term, limit=25, sort='likes', expand=['runtime', 'likes', 'sdk']):
            stage = getattr(getattr(s, 'runtime', None), 'stage', '?')
            hw = getattr(getattr(s, 'runtime', None), 'hardware', '?')
            print(f'  {s.id:60s} likes={s.likes} stage={stage} hw={hw}')
    except Exception as e:
        print('  FAILED', e)
