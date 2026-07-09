<?php
/**
 * Schema Injector — Injects AMPS schema into HTML for LLM discovery
 *
 * Phase 6 Auto-Discovery Flow (IP-Only Detection):
 * 1. LLM (Claude, GPT, etc.) visits site via web_fetch or browser
 * 2. This class detects LLM via IP address (IP ranges from official provider docs)
 * 3. IP-only approach works even with generic User-Agent (web_fetch)
 * 4. Calls gateway /v1/schema/inject endpoint to fetch signed schema
 * 5. Injects schema into <footer> of HTML response
 * 6. LLM parses HTML, finds schema script tag, verifies signature
 * 7. LLM discovers AMPS tools → continues interaction
 *
 * Security Model:
 * - IP ranges are authoritative (cannot be spoofed at network layer)
 * - User-Agent is NOT checked (easily spoofed, not required for web_fetch)
 * - Validates response structure before injection
 * - Caches schema to reduce gateway load
 * - Silent error handling (no user-facing errors)
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Schema_Injector {

	private const CACHE_KEY_SCHEMA = 'agentmesh_schema_cache';
	private const CACHE_KEY_RATE_LIMIT = 'agentmesh_schema_rate_limit_%s';
	private const CACHE_TTL = 300; // 5 minutes
	private const RATE_LIMIT_TTL = 300; // 5 minutes
	private const RATE_LIMIT_MAX = 1; // 1 request per TTL per IP

	/**
	 * Initialize the schema injector.
	 */
	public function init(): void {
		// Only inject schema on front-end, not in admin or REST API
		if ( ! is_admin() && ! $this->is_rest_request() ) {
			// Hook into wp_footer (just before </body>) for schema injection
			add_action( 'wp_footer', [ $this, 'inject_schema' ], 1 );
		}
	}

	/**
	 * Determine if this is a REST API request.
	 */
	private function is_rest_request(): bool {
		return defined( 'REST_REQUEST' ) && REST_REQUEST;
	}

	/**
	 * Inject schema into HTML if visitor is an LLM (IP-based detection).
	 */
	public function inject_schema(): void {
		// Check if schema injection is enabled
		if ( ! get_option( 'agentmesh_schema_injection_enabled', true ) ) {
			return;
		}

		// Verify visitor is an LLM by IP address (IP-only detection)
		if ( ! AgentMesh_IP_Validator::is_llm_request() ) {
			return;
		}

		// Get schema from cache or fetch from gateway
		$schema = $this->get_schema();

		if ( empty( $schema ) ) {
			// Silently skip if schema unavailable
			return;
		}

		// Validate schema structure before injection
		if ( ! $this->is_valid_schema( $schema ) ) {
			// Invalid schema, skip injection
			return;
		}

		echo $this->render_schema_tag( $schema ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	/**
	 * Get schema from cache or fetch from gateway.
	 *
	 * @return array|null Schema array or null if unavailable
	 */
	private function get_schema(): ?array {
		// Check rate limit before fetching
		if ( ! $this->check_rate_limit() ) {
			return null;
		}

		// Try to get cached schema
		$cached_schema = wp_cache_get( self::CACHE_KEY_SCHEMA );
		if ( is_array( $cached_schema ) && ! empty( $cached_schema ) ) {
			return $cached_schema;
		}

		// Fetch schema from gateway
		$schema = $this->fetch_schema_from_gateway();

		if ( is_array( $schema ) && ! empty( $schema ) ) {
			// Cache the schema
			wp_cache_set( self::CACHE_KEY_SCHEMA, $schema, '', self::CACHE_TTL );
			$this->record_rate_limit();
			return $schema;
		}

		return null;
	}

	/**
	 * Check and enforce rate limiting.
	 */
	private function check_rate_limit(): bool {
		$client_ip = $this->get_client_ip();
		$rate_limit_key = sprintf( self::CACHE_KEY_RATE_LIMIT, $client_ip );

		$attempt_count = wp_cache_get( $rate_limit_key );

		if ( false === $attempt_count ) {
			// First attempt in this period
			return true;
		}

		// If we've already made max requests, skip
		if ( $attempt_count >= self::RATE_LIMIT_MAX ) {
			return false;
		}

		return true;
	}

	/**
	 * Record a schema fetch attempt for rate limiting.
	 */
	private function record_rate_limit(): void {
		$client_ip = $this->get_client_ip();
		$rate_limit_key = sprintf( self::CACHE_KEY_RATE_LIMIT, $client_ip );

		$attempt_count = wp_cache_get( $rate_limit_key );
		if ( false === $attempt_count ) {
			$attempt_count = 0;
		}

		wp_cache_set( $rate_limit_key, $attempt_count + 1, '', self::RATE_LIMIT_TTL );
	}

	/**
	 * Get client IP address.
	 */
	private function get_client_ip(): string {
		// Check for shared internet
		if ( ! empty( $_SERVER['HTTP_CLIENT_IP'] ) ) {
			$ip = sanitize_text_field( wp_unslash( $_SERVER['HTTP_CLIENT_IP'] ) );
		} elseif ( ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
			// Handle multiple IPs in X-Forwarded-For (take the first)
			$ips = array_map( 'trim', explode( ',', sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) ) );
			$ip = reset( $ips );
		} else {
			$ip = ! empty( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '0.0.0.0';
		}

		// Validate IP
		if ( filter_var( $ip, FILTER_VALIDATE_IP ) ) {
			return $ip;
		}

		return '0.0.0.0';
	}

	/**
	 * Fetch schema from gateway endpoint.
	 *
	 * @return array|null Schema array or null on error
	 */
	private function fetch_schema_from_gateway(): ?array {
		$gateway_url = get_option( 'agentmesh_gateway_url', 'https://api.synchronity.app' );

		if ( empty( $gateway_url ) ) {
			return null;
		}

		$endpoint = trailingslashit( $gateway_url ) . 'v1/schema/inject?method=json&compact=true';

		$response = wp_remote_get(
			$endpoint,
			[
				'timeout'   => 5,
				'sslverify' => ! defined( 'AGENTMESH_DEV_MODE' ) || ! AGENTMESH_DEV_MODE,
			]
		);

		// Check for HTTP errors
		if ( is_wp_error( $response ) ) {
			// Silently log error for debugging (no user-facing errors)
			do_action( 'agentmesh_schema_fetch_error', $response->get_error_message() );
			return null;
		}

		$http_code = wp_remote_retrieve_response_code( $response );

		// Accept 200 OK and 304 Not Modified
		if ( ! in_array( $http_code, [ 200, 304 ], true ) ) {
			do_action( 'agentmesh_schema_fetch_error', "HTTP {$http_code}" );
			return null;
		}

		$body = wp_remote_retrieve_body( $response );

		if ( empty( $body ) ) {
			return null;
		}

		$schema = json_decode( $body, true );

		if ( ! is_array( $schema ) ) {
			do_action( 'agentmesh_schema_fetch_error', 'Invalid JSON response' );
			return null;
		}

		return $schema;
	}

	/**
	 * Validate schema structure.
	 *
	 * @param array $schema Schema to validate
	 * @return bool True if valid
	 */
	private function is_valid_schema( array $schema ): bool {
		// Minimum required fields for AMPS schema
		$required_fields = [
			'amps',           // AMPS namespace
			'version',        // Schema version
			'signature',      // Digital signature
		];

		foreach ( $required_fields as $field ) {
			if ( ! isset( $schema[ $field ] ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Render schema as HTML script tag.
	 *
	 * @param array $schema Schema to inject
	 * @return string HTML script tag
	 */
	private function render_schema_tag( array $schema ): string {
		$schema_json = json_encode( $schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );

		if ( false === $schema_json ) {
			return '';
		}

		$schema_json_escaped = esc_attr( $schema_json );

		return sprintf(
			'<script type="application/ld+json" id="agentmesh-amps-schema">%s</script>' . "\n",
			$schema_json
		);
	}

	/**
	 * Clear schema cache (useful for testing or manual refresh).
	 */
	public function clear_cache(): void {
		wp_cache_delete( self::CACHE_KEY_SCHEMA );
	}
}
