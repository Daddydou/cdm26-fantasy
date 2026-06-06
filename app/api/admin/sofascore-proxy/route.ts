import { NextRequest, NextResponse } from 'next/server'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Paramètre url manquant' }, { status: 400, headers: CORS })
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(url)
  } catch {
    return NextResponse.json({ error: 'URL invalide' }, { status: 400, headers: CORS })
  }

  if (!decoded.startsWith('https://api.sofascore.com/')) {
    return NextResponse.json({ error: 'URL non autorisée' }, { status: 403, headers: CORS })
  }

  let res: Response
  try {
    res = await fetch(decoded, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'https://www.sofascore.com/',
        'Accept': 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Timeout ou réseau'
    return NextResponse.json({ error: msg }, { status: 502, headers: CORS })
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `SofaScore a répondu ${res.status}` },
      { status: res.status, headers: CORS }
    )
  }

  const data = await res.json()
  return NextResponse.json(data, { headers: CORS })
}
