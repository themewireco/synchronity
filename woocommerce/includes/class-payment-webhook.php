<?php
/**
 * Payment webhook handler — processes payment confirmations from WooCommerce payment gateways.
 * 
 * Listens to WooCommerce payment events and notifies Synchronity Gateway.
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Payment_Webhook {

	private AgentMesh_Auth $auth;

	public function __construct() {
		$this->auth = new AgentMesh_Auth();
	}

	public function register_routes(): void {
		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/webhooks/payment',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ $this, 'handle_payment_webhook' ],
				'permission_callback' => [ $this->auth, 'verify_webhook_signature' ],
			]
		);
	}

	/**
	 * Handle incoming payment webhook from WooCommerce or external payment gateway.
	 * 
	 * Expected payload:
	 * {
	 *   "event": "payment_completed" | "payment_failed",
	 *   "order_id": 12345,
	 *   "transaction_id": "txn_123456789",
	 *   "gateway": "stripe" | "paypal" | "square",
	 *   "amount": 99.99,
	 *   "currency": "USD",
	 *   "timestamp": "2024-01-15T10:30:00Z"
	 * }
	 */
	public function handle_payment_webhook( WP_REST_Request $request ): WP_REST_Response {
		$event            = sanitize_text_field( $request->get_param( 'event' ) );
		$order_id         = (int) $request->get_param( 'order_id' );
		$transaction_id   = sanitize_text_field( $request->get_param( 'transaction_id' ) ?: '' );
		$gateway          = sanitize_text_field( $request->get_param( 'gateway' ) ?: '' );
		$amount           = (float) $request->get_param( 'amount' );
		$currency         = sanitize_text_field( $request->get_param( 'currency' ) ?: 'USD' );
		$timestamp        = sanitize_text_field( $request->get_param( 'timestamp' ) ?: current_time( 'c' ) );

		// Validate required fields
		if ( ! in_array( $event, [ 'payment_completed', 'payment_failed' ], true ) ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'INVALID_EVENT', 'event must be "payment_completed" or "payment_failed".' ),
				400
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		if ( empty( $order_id ) ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'order_id is required.' ),
				400
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'NOT_FOUND', 'Order not found.' ),
				404
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		// Log payment webhook event
		$this->log_payment_event( $order_id, $event, $transaction_id, $gateway, $amount, $currency, $timestamp );

		// Handle payment completion
		if ( 'payment_completed' === $event ) {
			$this->handle_payment_completed( $order, $transaction_id, $gateway, $amount, $currency, $timestamp );
		} else {
			$this->handle_payment_failed( $order, $transaction_id, $gateway, $timestamp );
		}

		// Notify Gateway of payment status update
		$this->notify_gateway( $order, $event, $transaction_id );

		$site_id = (string) get_option( 'agentmesh_site_id', '' );
		$response = new WP_REST_Response( AgentMesh_Normaliser::order_to_amps( $order, $site_id ), 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// Payment handlers
	// ─────────────────────────────────────────────────────────────────

	private function handle_payment_completed( WC_Order $order, string $transaction_id, string $gateway, float $amount, string $currency, string $timestamp ): void {
		// Update order metadata
		$order->update_meta_data( '_agentmesh_payment_gateway', $gateway );
		$order->update_meta_data( '_agentmesh_transaction_id', $transaction_id );
		$order->update_meta_data( '_agentmesh_payment_completed_at', $timestamp );

		// Clear payment URL metadata — order is now paid, no longer pending payment
		$order->delete_meta_data( '_agentmesh_payment_url' );

		// Verify amount matches (fraud check)
		$order_total = (float) $order->get_total();
		if ( abs( $order_total - $amount ) > 0.01 ) { // Allow 1 cent variance
			$order->update_meta_data( '_agentmesh_payment_mismatch', true );
			$order->update_meta_data( '_agentmesh_payment_expected', $order_total );
			$order->update_meta_data( '_agentmesh_payment_received', $amount );
			$order->add_order_note(
				sprintf(
					'Payment amount mismatch detected. Expected: %s %s, Received: %s %s. Order flagged for review.',
					wc_price( $order_total, [ 'currency' => $order->get_currency() ] ),
					$order->get_currency(),
					wc_price( $amount, [ 'currency' => $currency ] ),
					$currency
				),
				false,
				true
			);
		}

		// Mark payment complete
		$order->payment_complete( $transaction_id );
		$order->add_order_note(
			sprintf(
				'Payment completed via %s gateway. Transaction ID: %s',
				ucfirst( $gateway ),
				esc_html( $transaction_id )
			),
			false,
			true
		);

		$order->save();
	}

	private function handle_payment_failed( WC_Order $order, string $transaction_id, string $gateway, string $timestamp ): void {
		$order->update_meta_data( '_agentmesh_payment_failed_at', $timestamp );
		$order->update_meta_data( '_agentmesh_transaction_id', $transaction_id );
		$order->set_status( 'failed' );
		$order->add_order_note(
			sprintf(
				'Payment failed via %s gateway. Transaction ID: %s. Order status set to failed.',
				ucfirst( $gateway ),
				esc_html( $transaction_id )
			),
			false,
			true
		);
		$order->save();
	}

	// ─────────────────────────────────────────────────────────────────
	// Cache invalidation
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Invalidate order cache in Synchronity Gateway.
	 * This ensures Claude and other clients get fresh order data.
	 */
	private function invalidate_order_cache( string $gateway_url, string $site_id, int $order_id, string $connector_key ): void {
		$url       = trailingslashit( $gateway_url ) . 'v1/sites/' . $site_id . '/orders/' . $order_id . '/invalidate-cache';
		$signature = hash_hmac( 'sha256', '', $connector_key );

		$args = [
			'method'  => 'POST',
			'timeout' => 10,
			'headers' => [
				'Content-Type'             => 'application/json',
				'X-AgentMesh-Site-Id'      => $site_id,
				'X-AgentMesh-Signature'    => 'sha256=' . $signature,
			],
			'body'    => wp_json_encode( [] ),
		];

		// Fire-and-forget
		wp_remote_post( $url, $args );
	}

	// ─────────────────────────────────────────────────────────────────
	// Audit logging
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Log payment event to audit trail.
	 */
	private function log_payment_event( int $order_id, string $event, string $transaction_id, string $gateway, float $amount, string $currency, string $timestamp ): void {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return;
		}

		$agent_name = $order->get_meta( '_agentmesh_agent_name' );
		$human_sub  = $order->get_meta( '_agentmesh_human_sub' );

		$audit_entry = [
			'timestamp'      => $timestamp,
			'order_id'       => $order_id,
			'event'          => $event,
			'transaction_id' => $transaction_id,
			'gateway'        => $gateway,
			'amount'         => $amount,
			'currency'       => $currency,
			'agent_name'     => $agent_name ?: null,
			'human_sub'      => $human_sub ?: null,
		];

		// Store in order metadata
		$audit_log = $order->get_meta( '_agentmesh_payment_audit_log' ) ?: [];
		if ( ! is_array( $audit_log ) ) {
			$audit_log = [];
		}
		$audit_log[] = $audit_entry;
		$order->update_meta_data( '_agentmesh_payment_audit_log', $audit_log );

		// Log to payment audit log table if available
		$this->write_audit_log_entry( $audit_entry );
	}

	/**
	 * Write to optional audit log table for searchability.
	 */
	private function write_audit_log_entry( array $entry ): void {
		global $wpdb;

		// Check if custom audit log table exists
		$table_name = $wpdb->prefix . 'agentmesh_payment_audit_log';
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table_name ) ) !== $table_name ) {
			return;
		}

		$wpdb->insert(
			$table_name,
			[
				'timestamp'      => $entry['timestamp'],
				'order_id'       => $entry['order_id'],
				'event'          => $entry['event'],
				'transaction_id' => $entry['transaction_id'],
				'gateway'        => $entry['gateway'],
				'amount'         => $entry['amount'],
				'currency'       => $entry['currency'],
				'agent_name'     => $entry['agent_name'],
				'human_sub'      => $entry['human_sub'],
			],
			[ '%s', '%d', '%s', '%s', '%s', '%f', '%s', '%s', '%s' ]
		);
	}

	// ─────────────────────────────────────────────────────────────────
	// Gateway notification
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Notify Synchronity Gateway of payment status change.
	 */
	private function notify_gateway( WC_Order $order, string $event, string $transaction_id ): void {
		$gateway_url = get_option( 'agentmesh_gateway_url', '' );
		if ( empty( $gateway_url ) ) {
			return;
		}

		$site_id       = (string) get_option( 'agentmesh_site_id', '' );
		$connector_key = get_option( 'agentmesh_connector_key', '' );
		$order_id      = $order->get_id();
		$agent_name    = $order->get_meta( '_agentmesh_agent_name' );
		$human_sub     = $order->get_meta( '_agentmesh_human_sub' );

		$payload = [
			'order_id'       => $order_id,
			'event'          => $event,
			'transaction_id' => $transaction_id,
			'gateway'        => $order->get_payment_method(),
			'amount'         => (float) $order->get_total(),
			'currency'       => $order->get_currency(),
			'agent_name'     => $agent_name ?: null,
			'human_sub'      => $human_sub ?: null,
			'timestamp'      => current_time( 'c' ),
		];

		$body      = wp_json_encode( $payload );
		$signature = hash_hmac( 'sha256', $body, $connector_key );
		$url       = trailingslashit( $gateway_url ) . 'v1/sites/' . $site_id . '/webhooks/payment';

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

		// Fire-and-forget via Action Scheduler if available
		if ( function_exists( 'as_enqueue_async_action' ) ) {
			as_enqueue_async_action(
				'agentmesh_notify_gateway_payment',
				[ 'url' => $url, 'args' => $args, 'site_id' => $site_id, 'order_id' => $order_id, 'connector_key' => $connector_key, 'gateway_url' => $gateway_url ],
				'agentmesh'
			);
		} else {
			wp_remote_post( $url, $args );
			// Also invalidate cache synchronously
			$this->invalidate_order_cache( $gateway_url, $site_id, $order_id, $connector_key );
		}
	}
}

/**
 * Action Scheduler callback for async gateway notification.
 */
add_action(
	'agentmesh_notify_gateway_payment',
	function ( string $url, array $args, string $site_id = '', int $order_id = 0, string $connector_key = '', string $gateway_url = '' ) {
		wp_remote_post( $url, $args );
		
		// Also invalidate cache asynchronously if we have the parameters
		if ( $gateway_url && $site_id && $order_id && $connector_key ) {
			$cache_invalidation_url = trailingslashit( $gateway_url ) . 'v1/sites/' . $site_id . '/orders/' . $order_id . '/invalidate-cache';
			$signature              = hash_hmac( 'sha256', '', $connector_key );

			$cache_args = [
				'method'  => 'POST',
				'timeout' => 10,
				'headers' => [
					'Content-Type'             => 'application/json',
					'X-AgentMesh-Site-Id'      => $site_id,
					'X-AgentMesh-Signature'    => 'sha256=' . $signature,
				],
				'body'    => wp_json_encode( [] ),
			];

			wp_remote_post( $cache_invalidation_url, $cache_args );
		}
	},
	10,
	6
);
