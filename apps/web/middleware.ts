import { NextResponse, type NextRequest } from 'next/server';
import { isDesignReferenceAllowed } from './lib/design-reference';

// ÜRÜN-019: /design referans rotası yalnız dev/staging'de görünür.
// Production'da (DEPLOY_ENV=production) 404 döner.
export function middleware(_request: NextRequest) {
  if (!isDesignReferenceAllowed(process.env.DEPLOY_ENV)) {
    return new NextResponse('Not Found', { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/design'],
};
