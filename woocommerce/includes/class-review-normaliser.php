<?php
/**
 * WooCommerce Review Normaliser - Converts WC reviews to AMPS format
 *
 * @package AgentMesh
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Review_Normaliser {

	/**
	 * Normalize WooCommerce review to AMPS format
	 *
	 * @param WP_Comment $review WooCommerce review comment.
	 * @param int        $product_id Product ID.
	 * @return array AMPS-formatted review.
	 */
	public static function normalize_review( $review, $product_id ) {
		$rating = (int) get_comment_meta( $review->comment_ID, 'rating', true );
		if ( $rating < 1 || $rating > 5 ) {
			$rating = 3;
		}

		return [
			'review_id'           => (string) $review->comment_ID,
			'product_id'          => (string) $product_id,
			'rating'              => $rating,
			'title'               => $review->comment_author,
			'body'                => $review->comment_content,
			'author'              => $review->comment_author,
			'verified_purchase'   => (bool) get_comment_meta( $review->comment_ID, 'verified', true ),
			'helpful_count'       => (int) get_comment_meta( $review->comment_ID, 'helpful', true ),
			'unhelpful_count'     => (int) get_comment_meta( $review->comment_ID, 'unhelpful', true ),
			'created_at'          => gmdate( 'Y-m-d\TH:i:s\Z', strtotime( $review->comment_date_gmt ) ),
			'source'              => 'woocommerce',
			'metadata'            => [
				'reviewer_email' => $review->comment_author_email,
			],
		];
	}

	/**
	 * Alias for normalize_review to match endpoint expectations
	 *
	 * @param WP_Comment $review WooCommerce review comment.
	 * @return array AMPS-formatted review.
	 */
	public static function review_to_amps( $review ) {
		return self::normalize_review( $review, $review->comment_post_ID );
	}

	/**
	 * Normalize review consensus to AMPS format
	 *
	 * @param int $product_id Product ID.
	 * @return array AMPS ReviewConsensus.
	 */
	public static function normalize_consensus( $product_id ) {
		return AgentMesh_Reviews::calculate_consensus( $product_id );
	}
}
