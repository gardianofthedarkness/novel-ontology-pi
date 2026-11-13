"""Print the API of Hugging Face Spaces (endpoints and parameters), anonymously."""
import sys
from gradio_client import Client
for space in sys.argv[1:]:
    print('=' * 20, space)
    try:
        c = Client(space, verbose=False)
        c.view_api(print_info=True)
    except Exception as e:
        print('FAILED', type(e).__name__, str(e)[:300])
