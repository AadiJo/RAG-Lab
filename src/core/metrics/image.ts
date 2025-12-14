/**
 * Image Embedding Evaluation Metrics
 * 
 * Evaluates the quality of image retrieval in the RAG system:
 * - Image Relevance Rate: % of retrieved images that are relevant
 * - Image-Query Alignment: Semantic similarity between query and images
 * - Image Context Coverage: Do images add information beyond text?
 */

import type { RetrievedImage, GroundTruth, ImageMetrics } from '@/types';

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if an image is relevant based on ground truth keywords
 */
function isImageRelevant(
  image: RetrievedImage,
  expectedKeywords: string[],
  expectedImages?: string[]
): { isRelevant: boolean; matchedKeywords: string[] } {
  const matchedKeywords: string[] = [];

  // Check filename match if expected images are provided
  if (expectedImages && expectedImages.length > 0) {
    const normalizedFilename = image.filename.toLowerCase();
    for (const expected of expectedImages) {
      if (
        normalizedFilename.includes(expected.toLowerCase()) ||
        expected.toLowerCase().includes(normalizedFilename)
      ) {
        return { isRelevant: true, matchedKeywords: [expected] };
      }
    }
  }

  // Check OCR text and context summary for keyword matches
  const imageText = [
    image.ocrText || '',
    image.contextSummary || '',
    image.filename || '',
  ]
    .join(' ')
    .toLowerCase();

  for (const keyword of expectedKeywords) {
    if (imageText.includes(keyword.toLowerCase())) {
      matchedKeywords.push(keyword);
    }
  }

  // Image is relevant if it matches at least one keyword
  return {
    isRelevant: matchedKeywords.length > 0,
    matchedKeywords,
  };
}

/**
 * Calculate keyword coverage score for an image
 */
function calculateImageKeywordScore(
  image: RetrievedImage,
  expectedKeywords: string[]
): number {
  if (expectedKeywords.length === 0) return 0;

  const imageText = [
    image.ocrText || '',
    image.contextSummary || '',
    image.filename || '',
  ]
    .join(' ')
    .toLowerCase();

  let matchCount = 0;
  for (const keyword of expectedKeywords) {
    if (imageText.includes(keyword.toLowerCase())) {
      matchCount++;
    }
  }

  return matchCount / expectedKeywords.length;
}

/**
 * Calculate how much unique information images add beyond text context
 * Compares image OCR/context against the text documents
 */
function calculateContextCoverage(
  images: RetrievedImage[],
  textContext: string,
  expectedKeywords: string[]
): number {
  if (images.length === 0 || expectedKeywords.length === 0) return 0;

  const normalizedTextContext = normalizeText(textContext);

  // Find keywords in text context
  const keywordsInText = new Set<string>();
  for (const keyword of expectedKeywords) {
    if (normalizedTextContext.includes(keyword.toLowerCase())) {
      keywordsInText.add(keyword.toLowerCase());
    }
  }

  // Find keywords only in images (not in text)
  const keywordsOnlyInImages = new Set<string>();
  for (const image of images) {
    const imageText = normalizeText(
      [image.ocrText || '', image.contextSummary || ''].join(' ')
    );

    for (const keyword of expectedKeywords) {
      const normalizedKeyword = keyword.toLowerCase();
      if (imageText.includes(normalizedKeyword) && !keywordsInText.has(normalizedKeyword)) {
        keywordsOnlyInImages.add(normalizedKeyword);
      }
    }
  }

  // Coverage = proportion of keywords found only in images
  const totalMissing = expectedKeywords.length - keywordsInText.size;
  if (totalMissing === 0) return 0; // Text already covers everything

  return keywordsOnlyInImages.size / totalMissing;
}

/**
 * Calculate image-query alignment score
 * Based on keyword overlap between query and image content
 */
function calculateQueryAlignment(
  image: RetrievedImage,
  query: string
): number {
  const queryWords = new Set(
    normalizeText(query)
      .split(' ')
      .filter((w) => w.length > 2) // Filter short words
  );

  const imageText = normalizeText(
    [image.ocrText || '', image.contextSummary || '', image.filename || ''].join(' ')
  );
  const imageWords = new Set(imageText.split(' ').filter((w) => w.length > 2));

  if (queryWords.size === 0) return 0;

  let matchCount = 0;
  for (const word of queryWords) {
    if (imageWords.has(word)) {
      matchCount++;
    }
  }

  return matchCount / queryWords.size;
}

/**
 * Calculate all image metrics for a set of retrieved images
 */
export function calculateImageMetrics(
  images: RetrievedImage[],
  query: string,
  groundTruth: GroundTruth,
  textContext?: string
): ImageMetrics {
  if (images.length === 0) {
    return {
      imageCount: 0,
      relevantImages: 0,
      imageRelevanceRate: 0,
      avgImageQueryAlignment: 0,
      imageContextCoverage: 0,
    };
  }

  const { expectedKeywords, expectedImages } = groundTruth;

  // Count relevant images
  let relevantCount = 0;
  let totalAlignment = 0;

  for (const image of images) {
    const { isRelevant } = isImageRelevant(image, expectedKeywords, expectedImages);
    if (isRelevant) {
      relevantCount++;
    }
    totalAlignment += calculateQueryAlignment(image, query);
  }

  // Calculate context coverage (how much images add beyond text)
  const contextCoverage = textContext
    ? calculateContextCoverage(images, textContext, expectedKeywords)
    : 0;

  return {
    imageCount: images.length,
    relevantImages: relevantCount,
    imageRelevanceRate: relevantCount / images.length,
    avgImageQueryAlignment: totalAlignment / images.length,
    imageContextCoverage: contextCoverage,
  };
}

/**
 * Aggregate image metrics across multiple query results
 */
export function aggregateImageMetrics(
  results: ImageMetrics[]
): {
  avgImageCount: number;
  avgRelevantImages: number;
  avgImageRelevanceRate: number;
  avgImageQueryAlignment: number;
} {
  if (results.length === 0) {
    return {
      avgImageCount: 0,
      avgRelevantImages: 0,
      avgImageRelevanceRate: 0,
      avgImageQueryAlignment: 0,
    };
  }

  const sum = results.reduce(
    (acc, r) => ({
      imageCount: acc.imageCount + r.imageCount,
      relevantImages: acc.relevantImages + r.relevantImages,
      relevanceRate: acc.relevanceRate + r.imageRelevanceRate,
      alignment: acc.alignment + r.avgImageQueryAlignment,
    }),
    { imageCount: 0, relevantImages: 0, relevanceRate: 0, alignment: 0 }
  );

  const count = results.length;

  return {
    avgImageCount: sum.imageCount / count,
    avgRelevantImages: sum.relevantImages / count,
    avgImageRelevanceRate: sum.relevanceRate / count,
    avgImageQueryAlignment: sum.alignment / count,
  };
}

/**
 * Detailed image analysis for debugging and visualization
 */
export function analyzeImages(
  images: RetrievedImage[],
  query: string,
  groundTruth: GroundTruth
): Array<{
  filename: string;
  isRelevant: boolean;
  matchedKeywords: string[];
  alignmentScore: number;
  keywordScore: number;
}> {
  return images.map((image) => {
    const { isRelevant, matchedKeywords } = isImageRelevant(
      image,
      groundTruth.expectedKeywords,
      groundTruth.expectedImages
    );

    return {
      filename: image.filename,
      isRelevant,
      matchedKeywords,
      alignmentScore: calculateQueryAlignment(image, query),
      keywordScore: calculateImageKeywordScore(image, groundTruth.expectedKeywords),
    };
  });
}

