import threading
import time


dedupe_lock = threading.Lock()
last_heartbeat = time.time()

