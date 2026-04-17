import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(
  req: NextRequest,
  { params }: { params: { size: string } }
) {
  const size = Math.min(Math.max(parseInt(params.size) || 192, 32), 1024)

  // Try to use the real logo SVG. On Vercel/production this works because the
  // app can fetch from itself. Falls back gracefully if fetch fails.
  try {
    const origin = req.nextUrl.origin
    const logoUrl = `${origin}/icons/clean-buddies-logo.svg`

    // Verify the logo is accessible before using it in ImageResponse
    const probe = await fetch(logoUrl, { method: 'HEAD' }).catch(() => null)

    if (probe?.ok) {
      return new ImageResponse(
        (
          <div
            style={{
              width: size,
              height: size,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#ffffff',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              width={size}
              height={size}
              style={{ objectFit: 'contain' }}
              alt="Clean Buddies HQ"
            />
          </div>
        ),
        { width: size, height: size }
      )
    }
  } catch {
    // Fall through to generated icon
  }

  // Fallback: generated "CB" branded icon (no external dependencies)
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
        }}
      >
        <div
          style={{
            width: Math.round(size * 0.88),
            height: Math.round(size * 0.88),
            borderRadius: '50%',
            background: '#1D9E75',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              color: 'white',
              fontSize: Math.round(size * 0.28),
              fontWeight: 700,
              letterSpacing: '-0.02em',
              fontFamily: 'sans-serif',
              lineHeight: 1,
            }}
          >
            CB
          </span>
        </div>
      </div>
    ),
    { width: size, height: size }
  )
}
