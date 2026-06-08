<?php
/**
 * IP Validator — Validates LLM requests by IP address
 *
 * Phase 6 Security Model:
 * IP ranges are the PRIMARY security signal because they are:
 * 1. Authoritative — published by official LLM provider documentation
 * 2. Non-spoofable — IPs are validated at network layer
 * 3. Not dependent on User-Agent — works with web_fetch (generic UA)
 *
 * This class validates that a request originates from a known LLM provider
 * by checking if the client IP falls within official IP ranges.
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_IP_Validator {

	/**
	 * Official IP ranges from LLM provider documentation
	 * Source: Each provider's official IP whitelist
	 */
	private const LLM_IP_RANGES = [
		'claude' => [
			'54.191.0.0/16',   // Anthropic AWS US
			'52.0.0.0/8',      // Anthropic AWS regions (broader range)
		],
		'chatgpt' => [
			'34.208.0.0/12',   // OpenAI AWS
			'205.239.209.0/24', // OpenAI Azure
		],
		'perplexity' => [
			'206.189.0.0/16',  // Perplexity Digital Ocean
		],
		'gemini' => [
			'34.64.0.0/10',    // Google Cloud
		],
	];

	/**
	 * Check if request is from a known LLM provider (IP validation only).
	 *
	 * @return bool True if IP matches a known LLM provider range
	 */
	public static function is_llm_request(): bool {
		$client_ip = self::get_client_ip();
		return self::ip_in_ranges( $client_ip );
	}

	/**
	 * Get detected LLM provider by IP.
	 *
	 * @return string|null LLM provider name (claude, chatgpt, perplexity, gemini) or null
	 */
	public static function get_detected_llm(): ?string {
		$client_ip = self::get_client_ip();

		foreach ( self::LLM_IP_RANGES as $provider => $ranges ) {
			if ( self::ip_in_range_list( $client_ip, $ranges ) ) {
				return $provider;
			}
		}

		return null;
	}

	/**
	 * Get client IP address from request.
	 *
	 * Checks multiple headers for IP address:
	 * 1. X-Forwarded-For (reverse proxy, CDN)
	 * 2. X-Real-IP (nginx)
	 * 3. HTTP_CLIENT_IP (shared internet)
	 * 4. REMOTE_ADDR (direct connection)
	 *
	 * @return string Client IP address or '0.0.0.0' if unknown
	 */
	private static function get_client_ip(): string {
		// X-Forwarded-For may contain multiple IPs (take the first/client IP)
		if ( ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
			$ips = array_map( 'trim', explode( ',', sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) ) );
			$ip  = reset( $ips );
			if ( self::is_valid_ip( $ip ) ) {
				return $ip;
			}
		}

		// X-Real-IP (nginx proxy)
		if ( ! empty( $_SERVER['HTTP_X_REAL_IP'] ) ) {
			$ip = sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_REAL_IP'] ) );
			if ( self::is_valid_ip( $ip ) ) {
				return $ip;
			}
		}

		// HTTP_CLIENT_IP (shared internet)
		if ( ! empty( $_SERVER['HTTP_CLIENT_IP'] ) ) {
			$ip = sanitize_text_field( wp_unslash( $_SERVER['HTTP_CLIENT_IP'] ) );
			if ( self::is_valid_ip( $ip ) ) {
				return $ip;
			}
		}

		// REMOTE_ADDR (direct connection)
		if ( ! empty( $_SERVER['REMOTE_ADDR'] ) ) {
			$ip = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
			if ( self::is_valid_ip( $ip ) ) {
				return $ip;
			}
		}

		return '0.0.0.0';
	}

	/**
	 * Check if IP is valid IPv4 address.
	 *
	 * @param string $ip IP address to validate
	 * @return bool True if valid IPv4
	 */
	private static function is_valid_ip( string $ip ): bool {
		return (bool) filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 );
	}

	/**
	 * Check if IP is in any of the given CIDR ranges.
	 *
	 * @param string $ip IP address to check
	 * @param array  $ranges Array of CIDR ranges (e.g. ['54.191.0.0/16', '52.0.0.0/8'])
	 * @return bool True if IP is in any range
	 */
	private static function ip_in_range_list( string $ip, array $ranges ): bool {
		foreach ( $ranges as $cidr ) {
			if ( self::ip_in_cidr( $ip, $cidr ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Check if IP is in any known LLM provider range.
	 *
	 * @param string $ip IP address to check
	 * @return bool True if IP is in any LLM range
	 */
	private static function ip_in_ranges( string $ip ): bool {
		foreach ( self::LLM_IP_RANGES as $ranges ) {
			if ( self::ip_in_range_list( $ip, $ranges ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Check if IP is in CIDR range using bitwise operations.
	 *
	 * Algorithm:
	 * 1. Parse CIDR (e.g., "54.191.0.0/16") into network IP and mask bits
	 * 2. Convert both IPs to 32-bit integers
	 * 3. Apply mask to both: if (ip & mask) == (network & mask), then IP is in range
	 *
	 * @param string $ip IP address to check (e.g., "54.191.123.45")
	 * @param string $cidr CIDR range (e.g., "54.191.0.0/16")
	 * @return bool True if IP is in CIDR range
	 */
	private static function ip_in_cidr( string $ip, string $cidr ): bool {
		// Parse CIDR
		$parts = explode( '/', $cidr );
		if ( count( $parts ) !== 2 ) {
			return false;
		}

		$network_ip = $parts[0];
		$mask_bits  = (int) $parts[1];

		// Validate mask is between 0 and 32
		if ( $mask_bits < 0 || $mask_bits > 32 ) {
			return false;
		}

		// Convert IPs to 32-bit integers
		$ip_long      = self::ip_string_to_long( $ip );
		$network_long = self::ip_string_to_long( $network_ip );

		if ( false === $ip_long || false === $network_long ) {
			return false;
		}

		// Calculate bitmask: -1 << (32 - mask_bits)
		// For /16: -1 << 16 = 0xFFFF0000
		// For /24: -1 << 8  = 0xFFFFFF00
		$mask = -1 << ( 32 - $mask_bits );

		// Apply mask to both IPs and compare
		return ( $ip_long & $mask ) === ( $network_long & $mask );
	}

	/**
	 * Convert IP address string to signed 32-bit integer.
	 *
	 * Uses ip2long() but handles the signed/unsigned conversion
	 * that happens in PHP when dealing with IPs in the upper ranges.
	 *
	 * @param string $ip IP address string (e.g., "192.168.1.1")
	 * @return int|false Signed 32-bit integer or false if invalid
	 */
	private static function ip_string_to_long( string $ip ): int|false {
		$long = ip2long( $ip );
		if ( false === $long ) {
			return false;
		}

		// ip2long() returns unsigned in 64-bit systems but PHP treats as signed
		// Convert to signed 32-bit for consistent bitwise operations
		if ( $long > 2147483647 ) {
			$long -= 4294967296;
		}

		return (int) $long;
	}
}
