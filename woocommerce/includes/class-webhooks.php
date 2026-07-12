<?php
/**
 * Webhooks — registers WC action hooks and delivers events to the Synchronity Gateway.
 *
 * Events fired:
 *   woocommerce_product_updated  → POST {gateway}/v1/webhooks/inventory
 *   woocommerce_order_status_changed → POST {gateway}/v1/webhooks/order
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Webhooks {

	public function register_hooks(): void {
		add_action( 'woocommerce_product_updated', [ $this, 'on_product_updated' ], 10, 1 );
		add_action( 'woocommerce_order_status_changed', [ $this, 'on_order_status_changed' ], 10, 4 );
	}

	// ─────────────────────────────────────────────────────────────────
	// Hook callbacks
	// ─────────────────────────────────────────────────────────────────

	public function on_product_updated( int $product_id ): void {
		$product = wc_get_product( $product_id );
		if ( ! $product ) return;

		$site_id = (string) get_option( 'agentmesh_site_id', '' );
		$payload = AgentMesh_Normaliser::product_to_amps( $product, $site_id );

		$this->deliver( 'inventory', $payload );
	}

	public function on_order_status_changed( int $order_id, string $old_status, string $new_status, WC_Order $order ): void {
		$site_id = (string) get_option( 'agentmesh_site_id', '' );
		$payload = AgentMesh_Normaliser::order_to_amps( $order, $site_id );

		$this->deliver( 'order', $payload );
	}

	// ─────────────────────────────────────────────────────────────────
	// Delivery
	// ─────────────────────────────────────────────────────────────────

	/**
	 * POST a webhook payload to the Gateway.
	 *
	 * @param string $event   'inventory' | 'order'
	 * @param array  $payload AMPS-normalised payload
	 */
	private function deliver( string $event, array $payload ): void {
		$gateway_url   = (string) get_option( 'agentmesh_gateway_url', '' );
		$site_id       = (string) get_option( 'agentmesh_site_id', '' );
		$connector_key = (string) get_option( 'agentmesh_connector_key', '' );

		// Never deliver until the merchant has configured the connector against a
		// gateway. Without a gateway URL, site id and connector key there is no
		// service to talk to, so we make no outbound request (no phoning home).
		if ( '' === trim( $gateway_url ) || '' === trim( $site_id ) || '' === trim( $connector_key ) ) {
			return;
		}

		$body      = wp_json_encode( $payload );
		$signature = hash_hmac( 'sha256', $body, $connector_key );
		$url       = trailingslashit( $gateway_url ) . 'v1/webhooks/' . $event;

		$args = [
			'method'  => 'POST',
			'timeout' => 15,
			'headers' => [
				'Content-Type'             => 'application/json',
				'X-AgentMesh-Site-Id'      => $site_id,
				'X-AgentMesh-Signature'    => 'sha256=' . $signature,
			],
			'body'    => $body,
		];

		// Use WooCommerce's async delivery if available, otherwise fall back to wp_remote_post
		if ( function_exists( 'WC' ) && isset( WC()->queue ) && is_callable( [ WC()->queue, 'schedule_single' ] ) ) {
			// Schedule async delivery via WC Action Scheduler
			as_enqueue_async_action(
				'agentmesh_deliver_webhook',
				[ 'url' => $url, 'args' => $args ],
				'agentmesh'
			);
		} else {
			// Synchronous fallback
			wp_remote_post( $url, $args );
		}
	}
}

/**
 * Action Scheduler callback for async webhook delivery.
 */
add_action( 'agentmesh_deliver_webhook', function ( string $url, array $args ) {
	wp_remote_post( $url, $args );
}, 10, 2 );
