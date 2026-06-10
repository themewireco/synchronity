<?php
defined( 'ABSPATH' ) || exit;

/**
 * Enumerates ACF field definitions for the assisted add-on settings pickers.
 * Read-only, definition-level (cheap). Mirrors AgentMesh_Addons add-on-eligible types.
 */
class AgentMesh_ACF_Source {

	private const ELIGIBLE = [ 'select','radio','button_group','checkbox','true_false','text','textarea','email','url','number','range','repeater' ];

	/** @return array<int,array{name:string,key:string,label:string,type:string,choices?:array<string,string>}> */
	public static function addon_fields(): array {
		if ( ! function_exists( 'acf_get_field_groups' ) || ! function_exists( 'acf_get_fields' ) ) {
			return [];
		}
		$out = [];
		$seen = [];
		foreach ( acf_get_field_groups() as $group ) {
			$fields = acf_get_fields( $group );
			if ( ! is_array( $fields ) ) { continue; }
			foreach ( $fields as $f ) {
				$type = (string) ( $f['type'] ?? '' );
				$name = (string) ( $f['name'] ?? '' );
				if ( '' === $name || ! in_array( $type, self::ELIGIBLE, true ) || isset( $seen[ $name ] ) ) { continue; }
				$seen[ $name ] = true;
				$entry = [ 'name' => $name, 'key' => (string) ( $f['key'] ?? '' ), 'label' => (string) ( $f['label'] ?? $name ), 'type' => $type ];
				if ( ! empty( $f['choices'] ) && is_array( $f['choices'] ) ) { $entry['choices'] = $f['choices']; }
				$out[] = $entry;
			}
		}
		return $out;
	}

	/**
	 * Best-effort distinct outer-row titles for grouped (nested-repeater) add-ons.
	 * Bounded scan (<=50 recent published products with a repeater add-on field).
	 * @return string[]
	 */
	public static function grouped_group_titles(): array {
		if ( ! function_exists( 'get_posts' ) || ! function_exists( 'get_field' ) ) { return []; }
		$titles = [];
		$ids = get_posts( [ 'post_type' => 'product', 'post_status' => 'publish', 'numberposts' => 50, 'fields' => 'ids' ] );
		foreach ( (array) $ids as $pid ) {
			foreach ( self::addon_fields() as $f ) {
				if ( 'repeater' !== $f['type'] ) { continue; }
				$rows = get_field( $f['name'], $pid );
				if ( ! is_array( $rows ) ) { continue; }
				foreach ( $rows as $row ) {
					if ( is_array( $row ) ) {
						foreach ( $row as $v ) { if ( is_string( $v ) && '' !== $v ) { $titles[ $v ] = true; break; } }
					}
				}
			}
		}
		return array_keys( $titles );
	}
}
