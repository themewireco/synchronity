<?php
/**
 * Synchronity Reviews Aggregation & Authenticity Scoring
 *
 * @package AgentMesh
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Reviews {

	/**
	 * Get all reviews for a product with unified schema
	 *
	 * @param int $product_id WooCommerce product ID.
	 * @return array List of ProductReview objects.
	 */
	public static function get_product_reviews( $product_id ) {
		$product = wc_get_product( $product_id );
		if ( ! $product ) {
			return [];
		}

		$reviews = [];
		$comments = get_comments(
			[
				'post_id' => $product_id,
				'type'    => 'review',
				'status'  => 'approve',
			]
		);

		foreach ( $comments as $comment ) {
			$rating = (int) get_comment_meta( $comment->comment_ID, 'rating', true );
			if ( $rating < 1 || $rating > 5 ) {
				$rating = 3; // Default if missing.
			}

			$verified_purchase = (bool) get_comment_meta( $comment->comment_ID, 'verified', true );
			$helpful_count     = (int) get_comment_meta( $comment->comment_ID, 'helpful', true );
			$unhelpful_count   = (int) get_comment_meta( $comment->comment_ID, 'unhelpful', true );

			$reviews[] = [
				'review_id'           => (string) $comment->comment_ID,
				'product_id'          => (string) $product_id,
				'rating'              => $rating,
				'title'               => $comment->comment_author,
				'body'                => $comment->comment_content,
				'author'              => $comment->comment_author,
				'verified_purchase'   => $verified_purchase,
				'helpful_count'       => $helpful_count,
				'unhelpful_count'     => $unhelpful_count,
				'created_at'          => gmdate( 'Y-m-d\TH:i:s\Z', strtotime( $comment->comment_date_gmt ) ),
				'source'              => 'woocommerce',
				'metadata'            => [
					'reviewer_email' => $comment->comment_author_email,
				],
			];
		}

		return $reviews;
	}

	/**
	 * Calculate authenticity consensus from reviews
	 *
	 * @param int $product_id Product ID.
	 * @return array ReviewConsensus object.
	 */
	public static function calculate_consensus( $product_id ) {
		$reviews = self::get_product_reviews( $product_id );

		if ( empty( $reviews ) ) {
			return [
				'product_id'         => (string) $product_id,
				'average_rating'     => 0,
				'total_count'        => 0,
				'verified_count'     => 0,
				'verified_percentage' => 0.0,
				'trust_score'        => 0.5, // Neutral when no reviews.
				'consensus'          => 'questionable',
				'sentiment'          => [
					'positive_ratio' => 0.0,
					'neutral_ratio'  => 1.0,
					'negative_ratio' => 0.0,
				],
				'flags'              => [
					[
						'type'     => 'unverified_seller',
						'severity' => 'medium',
						'message'  => 'No reviews available for product authenticity assessment.',
					],
				],
				'recent_reviews'     => [],
				'cached_at'          => gmdate( 'Y-m-d\TH:i:s\Z' ),
			];
		}

		// Filter verified purchases.
		$verified = array_filter( $reviews, fn( $r ) => $r['verified_purchase'] );

		// Calculate average rating.
		$ratings = array_column( $reviews, 'rating' );
		$avg     = array_sum( $ratings ) / count( $ratings );

		// Analyze sentiment.
		$sentiment = self::analyze_sentiment( $reviews );

		// Detect anomalies.
		$flags = self::detect_flags( $reviews, $verified, $avg );

		// Compute trust score.
		$trust_score = self::compute_trust_score( $avg, count( $verified ), $sentiment, $flags );

		// Get recent reviews (last 5).
		$recent = array_slice( $reviews, -5 );

		// Determine consensus.
		if ( $trust_score >= 0.8 ) {
			$consensus = 'authentic';
		} elseif ( $trust_score >= 0.6 ) {
			$consensus = 'questionable';
		} else {
			$consensus = 'flagged';
		}

		return [
			'product_id'         => (string) $product_id,
			'average_rating'     => round( $avg, 2 ),
			'total_count'        => count( $reviews ),
			'verified_count'     => count( $verified ),
			'verified_percentage' => count( $verified ) > 0 ? round( count( $verified ) / count( $reviews ), 2 ) : 0.0,
			'trust_score'        => round( $trust_score, 2 ),
			'consensus'          => $consensus,
			'sentiment'          => [
				'positive_ratio' => round( $sentiment['positive'] / count( $reviews ), 2 ),
				'neutral_ratio'  => round( $sentiment['neutral'] / count( $reviews ), 2 ),
				'negative_ratio' => round( $sentiment['negative'] / count( $reviews ), 2 ),
			],
			'flags'              => $flags,
			'recent_reviews'     => $recent,
			'cached_at'          => gmdate( 'Y-m-d\TH:i:s\Z' ),
		];
	}

	/**
	 * Analyze sentiment from review text
	 *
	 * @param array $reviews Reviews array.
	 * @return array Sentiment counts {positive, neutral, negative}.
	 */
	private static function analyze_sentiment( $reviews ) {
		$positive_keywords = [ 'excellent', 'amazing', 'love', 'great', 'perfect', 'best', 'awesome', 'fantastic', 'highly recommend' ];
		$negative_keywords = [ 'poor', 'bad', 'terrible', 'waste', 'disappointed', 'broken', 'defective', 'never', 'avoid', 'worst' ];

		$sentiment = [
			'positive' => 0,
			'neutral'  => 0,
			'negative' => 0,
		];

		foreach ( $reviews as $review ) {
			$text = strtolower( $review['body'] . ' ' . $review['title'] );
			$has_positive = false;
			$has_negative = false;

			foreach ( $positive_keywords as $keyword ) {
				if ( strpos( $text, $keyword ) !== false ) {
					$has_positive = true;
					break;
				}
			}

			foreach ( $negative_keywords as $keyword ) {
				if ( strpos( $text, $keyword ) !== false ) {
					$has_negative = true;
					break;
				}
			}

			// Rating-based sentiment fallback.
			if ( ! $has_positive && ! $has_negative ) {
				if ( $review['rating'] >= 4 ) {
					$has_positive = true;
				} elseif ( $review['rating'] <= 2 ) {
					$has_negative = true;
				}
			}

			if ( $has_positive ) {
				$sentiment['positive']++;
			} elseif ( $has_negative ) {
				$sentiment['negative']++;
			} else {
				$sentiment['neutral']++;
			}
		}

		return $sentiment;
	}

	/**
	 * Detect suspicious patterns in reviews
	 *
	 * @param array $reviews All reviews.
	 * @param array $verified Verified reviews only.
	 * @param float $avg Average rating.
	 * @return array Flags array.
	 */
	private static function detect_flags( $reviews, $verified, $avg ) {
		$flags = [];

		// Flag 1: Low verified purchase percentage.
		$verified_pct = count( $verified ) / max( 1, count( $reviews ) );
		if ( $verified_pct < 0.3 ) {
			$flags[] = [
				'type'     => 'unverified_seller',
				'severity' => 'high',
				'message'  => sprintf( 'Only %.0f%% of reviews are from verified purchases.', $verified_pct * 100 ),
				'data'     => [
					'verified_percentage' => $verified_pct,
				],
			];
		}

		// Flag 2: Recent negative spike (last 5 reviews have low rating).
		if ( count( $reviews ) >= 5 ) {
			$recent_five = array_slice( $reviews, -5 );
			$recent_avg  = array_sum( array_column( $recent_five, 'rating' ) ) / 5;
			if ( $recent_avg < $avg - 1.0 ) {
				$flags[] = [
					'type'     => 'recent_negative_trend',
					'severity' => 'medium',
					'message'  => sprintf( 'Recent reviews average %.1f stars (down from %.1f overall).', $recent_avg, $avg ),
					'data'     => [
						'recent_average' => $recent_avg,
						'overall_average' => $avg,
					],
				];
			}
		}

		// Flag 3: Statistical outliers (5-star or 1-star clustering).
		$rating_dist = array_count_values( array_column( $reviews, 'rating' ) );
		if ( isset( $rating_dist[5] ) && $rating_dist[5] > count( $reviews ) * 0.7 ) {
			$flags[] = [
				'type'     => 'outliers_detected',
				'severity' => 'medium',
				'message'  => 'Suspiciously high concentration of 5-star reviews.',
				'data'     => [
					'five_star_count'    => $rating_dist[5],
					'five_star_percentage' => round( $rating_dist[5] / count( $reviews ), 2 ),
				],
			];
		}

		if ( isset( $rating_dist[1] ) && $rating_dist[1] > count( $reviews ) * 0.7 ) {
			$flags[] = [
				'type'     => 'outliers_detected',
				'severity' => 'high',
				'message'  => 'Suspiciously high concentration of 1-star reviews.',
				'data'     => [
					'one_star_count'     => $rating_dist[1],
					'one_star_percentage' => round( $rating_dist[1] / count( $reviews ), 2 ),
				],
			];
		}

		return $flags;
	}

	/**
	 * Calculate composite trust score
	 *
	 * @param float $avg_rating Average rating (1-5).
	 * @param int   $verified_count Number of verified reviews.
	 * @param array $sentiment Sentiment analysis.
	 * @param array $flags Detected flags.
	 * @return float Trust score (0.0-1.0).
	 */
	private static function compute_trust_score( $avg_rating, $verified_count, $sentiment, $flags ) {
		// Base score from rating: map 1-5 stars to 0.2-1.0.
		$rating_score = ( $avg_rating - 1 ) / 4 * 0.8 + 0.2;

		// Verified purchase bonus.
		$verified_bonus = min( $verified_count / 10, 0.15 ); // Max +0.15 from verified.

		// Sentiment analysis: negative reviews hurt more.
		$negative_ratio = isset( $sentiment['negative'] ) ? $sentiment['negative'] / max( 1, array_sum( $sentiment ) ) : 0;
		$sentiment_penalty = $negative_ratio * 0.2; // Max -0.2 from sentiment.

		// Flag penalties.
		$flag_penalty = 0;
		foreach ( $flags as $flag ) {
			if ( 'high' === $flag['severity'] ) {
				$flag_penalty += 0.15;
			} elseif ( 'medium' === $flag['severity'] ) {
				$flag_penalty += 0.08;
			} elseif ( 'low' === $flag['severity'] ) {
				$flag_penalty += 0.03;
			}
		}
		$flag_penalty = min( $flag_penalty, 0.4 ); // Cap at -0.4.

		$trust_score = $rating_score + $verified_bonus - $sentiment_penalty - $flag_penalty;
		return max( 0.0, min( 1.0, $trust_score ) );
	}
}
