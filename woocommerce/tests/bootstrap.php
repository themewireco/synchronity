<?php
/**
 * PHPUnit bootstrap — loads stubs so tests can run without a full WordPress install.
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'AGENTMESH_VERSION', '0.1.0' );
define( 'AGENTMESH_PLUGIN_DIR', dirname( __DIR__ ) . '/' );
define( 'AGENTMESH_REST_NAMESPACE', 'agentmesh/v1' );

// ─────────────────────────────────────────────────────────────────
// Minimal WordPress function stubs
// ─────────────────────────────────────────────────────────────────

if ( ! function_exists( 'get_option' ) ) {
	function get_option( $key, $default = false ) {
		global $_agentmesh_options;
		return $_agentmesh_options[ $key ] ?? $default;
	}
}

if ( ! function_exists( 'get_woocommerce_currency' ) ) {
	function get_woocommerce_currency(): string { return 'USD'; }
}

if ( ! function_exists( 'wc_get_product' ) ) {
	function wc_get_product( $id ) { return null; }
}

if ( ! function_exists( 'get_terms' ) ) {
	function get_terms( $args ) { return []; }
}

if ( ! function_exists( 'wc_get_product_terms' ) ) {
	function wc_get_product_terms( $product_id, $taxonomy, $args = [] ) { return []; }
}

if ( ! function_exists( 'wc_attribute_label' ) ) {
	function wc_attribute_label( $name, $product = null ): string { return $name; }
}

if ( ! function_exists( 'wp_get_attachment_url' ) ) {
	function wp_get_attachment_url( $id ) { return 'https://example.com/image-' . $id . '.jpg'; }
}

if ( ! function_exists( 'get_post_meta' ) ) {
	function get_post_meta( $post_id, $key, $single = false ) { return ''; }
}

if ( ! function_exists( 'hash_equals' ) ) {
	function hash_equals( $a, $b ): bool { return $a === $b; }
}

if ( ! function_exists( 'sanitize_text_field' ) ) {
	function sanitize_text_field( $str ): string { return trim( strip_tags( $str ) ); }
}

if ( ! function_exists( 'get_site_url' ) ) {
	function get_site_url(): string { return 'https://example.com'; }
}

if ( ! function_exists( 'set_transient' ) ) {
	function set_transient( $key, $value, $expiration = 0 ): bool { return true; }
}

if ( ! function_exists( 'get_transient' ) ) {
	function get_transient( $key ) { return false; }
}

if ( ! function_exists( 'delete_transient' ) ) {
	function delete_transient( $key ): bool { return true; }
}

if ( ! function_exists( 'wp_json_encode' ) ) {
	function wp_json_encode( $data ): string { return json_encode( $data ); }
}

if ( ! function_exists( 'trailingslashit' ) ) {
	function trailingslashit( $value ): string { return rtrim( $value, '/' ) . '/'; }
}

if ( ! function_exists( 'is_wp_error' ) ) {
	function is_wp_error( $thing ): bool { return $thing instanceof WP_Error; }
}

// Minimal WP_Error stub
if ( ! class_exists( 'WP_Error' ) ) {
	class WP_Error {
		public function __construct(
			public string $code = '',
			public string $message = '',
			public mixed $data = null
		) {}
		public function get_error_message(): string { return $this->message; }
	}
}

// Minimal WP_REST_Request stub
if ( ! class_exists( 'WP_REST_Request' ) ) {
	class WP_REST_Request {
		private array $params  = [];
		private array $headers = [];

		public function set_param( string $key, mixed $value ): void { $this->params[ $key ] = $value; }
		public function get_param( string $key ): mixed { return $this->params[ $key ] ?? null; }
		public function get_header( string $key ): ?string { return $this->headers[ strtolower( $key ) ] ?? null; }
		public function set_header( string $key, string $value ): void { $this->headers[ strtolower( $key ) ] = $value; }
	}
}

// Minimal WP_REST_Response stub
if ( ! class_exists( 'WP_REST_Response' ) ) {
	class WP_REST_Response {
		private array $headers = [];
		public function __construct(
			public mixed $data   = null,
			public int   $status = 200
		) {}
		public function header( string $key, string $value ): void { $this->headers[ $key ] = $value; }
		public function get_data(): mixed { return $this->data; }
		public function get_status(): int { return $this->status; }
		public function get_headers(): array { return $this->headers; }
	}
}

// ─────────────────────────────────────────────────────────────────
// Load plugin includes
// ─────────────────────────────────────────────────────────────────
require_once AGENTMESH_PLUGIN_DIR . 'includes/class-auth.php';
require_once AGENTMESH_PLUGIN_DIR . 'includes/class-normaliser.php';
