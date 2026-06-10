<?php
defined( 'ABSPATH' ) || exit;

/** Serialize/parse the price-map builder rows <-> the agentmesh_addon_price_map JSON. */
class AgentMesh_Price_Map {

	/** @param array<int,array> $rows -> JSON string keyed by field name. */
	public static function rows_to_json( array $rows ): string {
		$map = [];
		foreach ( $rows as $r ) {
			$field = trim( (string) ( $r['field'] ?? '' ) );
			if ( '' === $field ) { continue; }
			$type = (string) ( $r['type'] ?? '' );
			if ( 'amount' === $type ) {
				$map[ $field ] = [ 'amount' => (string) ( $r['amount'] ?? '' ) ];
			} elseif ( 'options' === $type ) {
				$opts = [];
				foreach ( (array) ( $r['options'] ?? [] ) as $value => $amt ) {
					$opts[ (string) $value ] = (string) $amt;
				}
				$map[ $field ] = [ 'options' => $opts ];
			} elseif ( 'price_field' === $type ) {
				$map[ $field ] = [ 'price_field' => (string) ( $r['price_field'] ?? '' ) ];
			}
		}
		return json_encode( (object) $map );
	}

	/** Inverse: JSON string -> rows array (for pre-populating the builder). */
	public static function json_to_rows( string $json ): array {
		$map = json_decode( $json, true );
		if ( ! is_array( $map ) ) { return []; }
		$rows = [];
		foreach ( $map as $field => $cfg ) {
			if ( ! is_array( $cfg ) ) { continue; }
			if ( isset( $cfg['amount'] ) ) {
				$rows[] = [ 'field' => (string) $field, 'type' => 'amount', 'amount' => (string) $cfg['amount'] ];
			} elseif ( isset( $cfg['options'] ) && is_array( $cfg['options'] ) ) {
				$opts = [];
				foreach ( $cfg['options'] as $v => $a ) { $opts[ (string) $v ] = (string) $a; }
				$rows[] = [ 'field' => (string) $field, 'type' => 'options', 'options' => $opts ];
			} elseif ( isset( $cfg['price_field'] ) ) {
				$rows[] = [ 'field' => (string) $field, 'type' => 'price_field', 'price_field' => (string) $cfg['price_field'] ];
			}
		}
		return $rows;
	}
}
