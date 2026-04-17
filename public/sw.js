/**
 * Clean Buddies HQ — Service Worker
 * Handles: app shell caching, offline fallback, push notifications
 */

const CACHE_NAME = 'cb-hq-v1'
const OFFLINE_URL = '/'

// Assets to pre-cache (Next.js builds change these hashes — only cache stable routes)
const PRECACHE_ROUTES = [
  '/',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
]

// ── Install: pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ROUTES).catch((err) => {
        console.warn('[SW] Pre-cache error (non-fatal):', err)
      })
    }).then(() => self.skipWaiting())
  )
})

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

// ── Fetch: network-first for API/navigation, cache-first for assets ──────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip non-GET and cross-origin requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return

  // API routes: network only — never cache
  if (url.pathname.startsWith('/api/')) return

  // Navigation requests: network-first, fallback to cached shell
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful navigation responses
          const cloned = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned))
          return response
        })
        .catch(() => {
          // Offline — return cached shell
          return caches.match(OFFLINE_URL).then((cached) => {
            if (cached) return cached
            // Last resort offline page
            return new Response(
              `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CB HQ — Offline</title>
  <style>
    body { margin: 0; background: #0A0A0F; color: #E8E8ED; font-family: Inter, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { text-align: center; padding: 2rem; }
    .dot { width: 48px; height: 48px; border-radius: 50%; background: #1D9E75; margin: 0 auto 1rem; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold; }
    h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
    p { color: #8A8A96; font-size: .875rem; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="dot">CB</div>
    <h1>You're offline</h1>
    <p>Connect to the internet to access Clean Buddies HQ</p>
  </div>
</body>
</html>`,
              { headers: { 'Content-Type': 'text/html' } }
            )
          })
        })
    )
    return
  }

  // Static assets (_next/static): cache-first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((response) => {
          const cloned = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned))
          return response
        })
      })
    )
    return
  }
})

// ── Push: show notification ──────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'CB HQ', message: 'New notification', link: '/', priority: 'medium' }

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() }
    }
  } catch (e) {
    if (event.data) data.message = event.data.text()
  }

  const priorityIcons = {
    urgent: '🔴',
    high: '🟡',
    medium: '🔵',
    low: '⚪',
  }
  const icon = priorityIcons[data.priority] || '🔵'

  const options = {
    body: `${icon} ${data.message}`,
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    tag: `cb-${data.priority}-${Date.now()}`,
    renotify: true,
    requireInteraction: data.priority === 'urgent' || data.priority === 'high',
    data: { link: data.link || '/' },
    actions: [
      { action: 'open', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  )
})

// ── Notification click: navigate to link ─────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') return

  const link = event.notification.data?.link || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If app is already open, focus and navigate
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(link)
          return
        }
      }
      // Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow(link)
      }
    })
  )
})
