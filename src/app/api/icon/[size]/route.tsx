import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(
  _req: NextRequest,
  { params }: { params: { size: string } }
) {
  const size = Math.min(Math.max(parseInt(params.size) || 192, 32), 1024)

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0A0F',
          borderRadius: Math.round(size * 0.22),
        }}
      >
        <div
          style={{
            width: Math.round(size * 0.72),
            height: Math.round(size * 0.72),
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
              fontSize: Math.round(size * 0.24),
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
    {
      width: size,
      height: size,
    }
  )
}
