'use client'
/**
 * Registers the service worker and handles push subscription storage.
 * Mounted once in the root layout — no visible UI.
 */
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export function PwaInit() {
  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('[PWA] Service worker registered, scope:', reg.scope)
      }).catch((err) => {
        console.warn('[PWA] Service worker registration failed:', err)
      })
    }
  }, [])

  return null
}

/** Request push notification permission and store subscription in Supabase */
export async function requestPushPermission(): Promise<{ ok: boolean; message: string }> {
  if (!('Notification' in window)) {
    return { ok: false, message: 'Notifications not supported in this browser.' }
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, message: 'Push notifications not supported in this browser.' }
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publicKey) {
    return { ok: false, message: 'Push not configured — NEXT_PUBLIC_VAPID_PUBLIC_KEY missing.' }
  }

  // Request permission
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, message: 'Notification permission denied.' }
  }

  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    if (existing) await existing.unsubscribe()

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as ArrayBuffer,
    })

    // Get logged in user
    const { data: { user } } = await supabase.auth.getUser()
    const email = user?.email || 'unknown'

    // Store subscription via API route (uses service role)
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON(), email }),
    })

    if (!res.ok) throw new Error('Failed to save subscription')

    return { ok: true, message: 'Push notifications enabled!' }
  } catch (err) {
    console.error('[PWA] Push subscription failed:', err)
    return { ok: false, message: `Failed to enable push: ${String(err)}` }
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
