// File: app/(store)/products/[slug]/page.tsx
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Star, Heart, Share2, Truck, Shield, RotateCcw } from 'lucide-react';
import {
  getProductBySlug,
  getRelatedProducts,
} from '@/server/queries/products';
import { AddToCart } from '@/components/add-to-cart';
import { ProductCard } from '@/components/product-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatPrice } from '@/lib/utils';
import { JsonLd } from '@/components/jsonld';
import { getProductReviews } from '@/server/actions/reviews';
import { getProductInquiries } from '@/server/actions/inquiries';
import { AiChat } from '@/components/product/ai-chat';
import { GroundedConsult } from '@/components/product/grounded-consult';
import { ProductReviews } from '@/components/product-reviews';
import { ProductInquiries } from '@/components/product-inquiries';

interface ProductPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return {
      title: 'Product Not Found',
    };
  }

  return {
    title: product.name,
    description: product.description || undefined,
    openGraph: {
      title: product.name,
      description: product.description || undefined,
      type: 'website',
      images: product.images.map(img => ({
        url: img.url,
        width: 1200,
        height: 630,
        alt: product.name,
      })),
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
      description: product.description || undefined,
      images: product.images.map(img => img.url),
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const relatedProducts = product.categoryId
    ? await getRelatedProducts(product.id, product.categoryId)
    : [];

  // 실제 리뷰·문의 데이터 조회
  const { reviews, summary } = await getProductReviews(product.id);
  const inquiries = await getProductInquiries(product.id);
  const averageRating = summary.average;
  const totalReviews = summary.count;

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.images.map(img => img.url),
    sku: product.sku,
    brand: {
      '@type': 'Brand',
      name: 'Store Brand',
    },
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      seller: {
        '@type': 'Organization',
        name: 'NextJS E-commerce Store',
      },
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: averageRating,
      reviewCount: totalReviews,
    },
  };

  return (
    <>
      <JsonLd data={structuredData} />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-8" aria-label="Breadcrumb">
          <ol className="flex items-center space-x-2 text-sm text-muted-foreground">
            <li>
              <Link href="/" className="hover:text-foreground">
                홈
              </Link>
            </li>
            <li>/</li>
            <li>
              <Link href="/products" className="hover:text-foreground">
                전체상품
              </Link>
            </li>
            <li>/</li>
            <li>
              <Link
                href={`/category/${product.category?.slug}`}
                className="hover:text-foreground"
              >
                {product.category?.name}
              </Link>
            </li>
            <li>/</li>
            <li className="font-medium text-foreground">{product.name}</li>
          </ol>
        </nav>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Product Images */}
          <div className="space-y-4">
            <div className="aspect-square overflow-hidden rounded-lg">
              <Image
                src={product.images[0]?.url || '/images/placeholder.png'}
                alt={product.name}
                width={600}
                height={600}
                className="h-full w-full object-cover"
                priority
              />
            </div>
            {product.images.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {product.images.slice(1, 5).map((image, index) => (
                  <div
                    key={index}
                    className="aspect-square overflow-hidden rounded-lg"
                  >
                    <Image
                      src={image.url}
                      alt={`${product.name} ${index + 2}`}
                      width={150}
                      height={150}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                {product.name}
              </h1>
              <div className="mt-2 flex items-center space-x-2">
                <div className="flex items-center">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`h-5 w-5 ${
                        i < Math.floor(averageRating)
                          ? 'fill-current text-yellow-400'
                          : 'text-gray-300'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-sm text-muted-foreground">
                  {averageRating} (후기 {totalReviews}개)
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-4">
                <span className="text-3xl font-bold text-gray-900">
                  {formatPrice(product.price)}
                </span>
                {product.comparePrice && (
                  <span className="text-xl text-muted-foreground line-through">
                    {formatPrice(product.comparePrice)}
                  </span>
                )}
              </div>
              {product.comparePrice && (
                <Badge variant="secondary">
                  {Math.round(
                    ((Number(product.comparePrice) - Number(product.price)) /
                      Number(product.comparePrice)) *
                      100
                  )}
                  % 할인
                </Badge>
              )}
            </div>

            <p className="text-gray-600">{product.description}</p>

            <div className="space-y-4">
              <div className="flex items-center space-x-4">
                <Badge variant="default">재고 있음</Badge>
                {product.sku && (
                  <span className="text-sm text-muted-foreground">
                    SKU: {product.sku}
                  </span>
                )}
              </div>

              <AddToCart
                productId={product.id}
                showQuantitySelector
                showBuyNow
              />

              <div className="flex space-x-2">
                <Button variant="outline" size="sm">
                  <Heart className="mr-2 h-4 w-4" />
                  찜하기
                </Button>
                <Button variant="outline" size="sm">
                  <Share2 className="mr-2 h-4 w-4" />
                  공유
                </Button>
              </div>
            </div>

            <Separator />

            {/* Features */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <Truck className="mx-auto h-8 w-8 text-blue-600" />
                <p className="mt-2 text-sm font-medium">무료배송</p>
                <p className="text-xs text-muted-foreground">
                  5만원 이상 구매 시
                </p>
              </div>
              <div>
                <Shield className="mx-auto h-8 w-8 text-green-600" />
                <p className="mt-2 text-sm font-medium">안전결제</p>
                <p className="text-xs text-muted-foreground">100% 보호</p>
              </div>
              <div>
                <RotateCcw className="mx-auto h-8 w-8 text-purple-600" />
                <p className="mt-2 text-sm font-medium">간편 교환·반품</p>
                <p className="text-xs text-muted-foreground">7일 이내 가능</p>
              </div>
            </div>
          </div>
        </div>

        {/* Product Details Tabs */}
        <div className="mt-16">
          <Tabs defaultValue="description" className="w-full">
            <TabsList>
              <TabsTrigger value="description">상품설명</TabsTrigger>
              <TabsTrigger value="reviews">
                상품후기 ({totalReviews})
              </TabsTrigger>
              <TabsTrigger value="inquiries">
                상품문의 ({inquiries.length})
              </TabsTrigger>
              <TabsTrigger value="shipping">배송/교환/반품</TabsTrigger>
              <TabsTrigger value="ai-chat">AI 상담</TabsTrigger>
              <TabsTrigger value="grounded">근거 상담</TabsTrigger>
            </TabsList>

            <TabsContent value="description" className="mt-8">
              <div className="prose max-w-none">
                <p>{product.content || product.description}</p>
              </div>
              <div className="mt-8 grid gap-4">
                <div className="grid grid-cols-2 gap-2 border-b py-2">
                  <span className="font-medium">상품코드</span>
                  <span>{product.sku}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 border-b py-2">
                  <span className="font-medium">카테고리</span>
                  <span>{product.category?.name}</span>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="reviews" className="mt-8">
              <ProductReviews
                productId={product.id}
                reviews={reviews.map(r => ({
                  id: r.id,
                  rating: r.rating,
                  title: r.title,
                  content: r.content,
                  verified: r.verified,
                  userName: r.user.name,
                  createdAt: r.createdAt.toISOString(),
                }))}
                summary={summary}
              />
            </TabsContent>

            <TabsContent value="inquiries" className="mt-8">
              <ProductInquiries
                productId={product.id}
                inquiries={inquiries.map(q => ({
                  id: q.id,
                  title: q.title,
                  content: q.content,
                  isSecret: q.isSecret,
                  locked: q.locked,
                  status: q.status,
                  answer: q.answer,
                  userName: q.user.name,
                  createdAt: q.createdAt.toISOString(),
                }))}
              />
            </TabsContent>

            <TabsContent value="shipping" className="mt-8">
              <div className="prose max-w-none">
                <h3>배송 안내</h3>
                <ul>
                  <li>5만원 이상 구매 시 무료배송 (미만 시 배송비 3,000원)</li>
                  <li>평일 오후 2시 이전 결제 완료 시 당일 출고</li>
                  <li>택배 배송으로 보통 1~2일 내 수령</li>
                </ul>

                <h3>교환/반품 안내</h3>
                <ul>
                  <li>상품 수령 후 7일 이내 교환·반품 신청 가능</li>
                  <li>상품이 훼손되지 않은 원상태여야 합니다</li>
                  <li>단순 변심 시 왕복 배송비는 고객 부담입니다</li>
                </ul>
              </div>
            </TabsContent>

            <TabsContent value="ai-chat" className="mt-8">
              <AiChat productSlug={product.slug} />
            </TabsContent>

            <TabsContent value="grounded" className="mt-8">
              <GroundedConsult productSlug={product.slug} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <div className="mt-16">
            <h2 className="mb-8 text-2xl font-bold tracking-tight text-gray-900">
              함께 보면 좋은 상품
            </h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {relatedProducts.map(relatedProduct => (
                <ProductCard
                  key={relatedProduct.id}
                  id={relatedProduct.id}
                  name={relatedProduct.name}
                  slug={relatedProduct.slug}
                  price={Number(relatedProduct.price)}
                  comparePrice={
                    relatedProduct.comparePrice
                      ? Number(relatedProduct.comparePrice)
                      : undefined
                  }
                  image={'/images/product-sample.svg'}
                  status={relatedProduct.status}
                  category={undefined}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
