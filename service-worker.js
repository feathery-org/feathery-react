// Constants for the IndexedDB database
const DB_NAME = 'offlineRequestsDB';
const STORE_NAME = 'offlineRequestsStore';
const DB_VERSION = 1;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

// Open a connection to the IndexedDB database
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function () {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Save request to IndexedDB
async function saveRequest(requestToSave) {
  const db = await openDatabase();

  try {
    const getTransaction = async () => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      return { tx, store };
    };

    const requestClone = requestToSave.clone();
    const serializedBody = await requestClone.blob().then(serializeRequestBody);

    const serializedRequest = {
      url: requestClone.url,
      method: requestClone.method,
      headers: JSON.stringify([...requestClone.headers]),
      body: serializedBody.body,
      bodyType: serializedBody.type,
      timestamp: Date.now()
    };

    const { tx, store } = await getTransaction();
    await store.add(serializedRequest);
    await tx.complete;
  } catch (error) {
    console.error('Error adding request to IndexedDB:', error);
  }
}

// Helper function to serialize request body based on its type
async function serializeRequestBody(body) {
  if (body instanceof Blob) {
    return { type: 'blob', body: await body.arrayBuffer() }; // Convert Blob to ArrayBuffer for storage
  } else if (body instanceof FormData) {
    // FormData needs to be converted to a plain object
    const formDataObj = {};
    body.forEach((value, key) => {
      formDataObj[key] = value;
    });
    return { type: 'formData', body: formDataObj };
  } else if (body instanceof ArrayBuffer) {
    return { type: 'arrayBuffer', body: body };
  } else {
    // Assume it's text or JSON
    return { type: 'text', body: await body.text() };
  }
}

// Replay requests from IndexedDB
async function replayRequests() {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  const requests = [];

  function cursorIterator(cursor) {
    if (!cursor) {
      // No more records, replay the requests
      replayRequestsFromArray(requests);
      return;
    }
    requests.push(cursor.value);
    cursor.continue();
  }

  store.openCursor().onsuccess = function (event) {
    const cursor = event.target.result;
    cursorIterator(cursor);
  };

  async function replayRequestsFromArray(requests) {
    requests.sort((a, b) => a.timestamp - b.timestamp);

    for (const request of requests) {
      if (!request.url) {
        console.warn('Request object missing url property:', request);
        continue;
      }

      let attempts = 0;
      let success = false;

      const { url, method, headers, body, bodyType } = request;
      let reconstructedBody;
      switch (bodyType) {
        case 'blob':
          reconstructedBody = new Blob([body]);
          break;
        case 'formData': {
          const formData = new FormData();
          Object.entries(body).forEach(([key, value]) => {
            formData.append(key, value);
          });
          reconstructedBody = formData;
          break;
        }
        case 'arrayBuffer':
          reconstructedBody = body;
          break;
        case 'text':
        default:
          reconstructedBody = body;
      }

      const fetchOptions = {
        method: method,
        headers: JSON.parse(headers)
      };

      if (method !== 'GET' && method !== 'HEAD') {
        fetchOptions.body = reconstructedBody;
      }

      while (!success && attempts < MAX_RETRY_ATTEMPTS) {
        try {
          const response = await fetch(url, fetchOptions);

          if (response.ok) {
            success = true;
          } else {
            attempts++;
            await delay(RETRY_DELAY_MS);
          }
        } catch (error) {
          console.error('Failed to replay request', error);
          attempts++;
          await delay(RETRY_DELAY_MS);

          if (attempts === MAX_RETRY_ATTEMPTS) {
            console.log(
              `Max retry attempts reached for request url: ${request.url}`
            );
            break;
          }
        }
      }

      try {
        const deleteTransaction = db.transaction(STORE_NAME, 'readwrite');
        const deleteStore = deleteTransaction.objectStore(STORE_NAME);
        deleteStore.clear();
        await deleteTransaction.complete;
      } catch (error) {
        console.error(
          `Error deleting request from IndexedDB: ${request.url}`,
          error
        );
      }
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

self.addEventListener('fetch', (event) => {
  if (navigator.onLine) {
    event.respondWith(fetch(event.request));
  } else {
    if (event.request.method !== 'GET') {
      event.respondWith(handleOfflineRequest(event.request));
    }
  }
});

function handleOfflineRequest(request) {
  return new Promise((resolve, reject) => {
    saveRequest(request)
      .then(() => {
        resolve(
          new Response('Offline request saved to IndexedDB', {
            headers: { 'Content-Type': 'text/plain' }
          })
        );
      })
      .catch(() => {
        reject(
          new Response('Failed to save offline request', {
            headers: { 'Content-Type': 'text/plain' }
          })
        );
      });
  });
}

// sync API does not seem to be supporeted for all browser
// self.addEventListener('sync', (event) => {
//   if (event.tag === 'replayRequests') {
//     event.waitUntil(replayRequests());
//   }
// });
// Instead using message to trigger replay
self.addEventListener('message', (event) => {
  if (event.data.type === 'replayRequests') {
    replayRequests();
  }
});

// Initialize the database when the service worker is installed
self.addEventListener('install', (event) => {
  event.waitUntil(openDatabase());
});
