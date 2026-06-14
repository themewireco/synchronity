#!/usr/bin/env php
<?php
error_reporting( E_ALL ); ini_set( 'display_errors', '1' );
define( 'ABSPATH', __DIR__ . '/' );
define( 'AGENTMESH_PLUGIN_DIR', dirname( __DIR__ ) . '/' );

$GLOBALS['_acf_groups'] = [];
$GLOBALS['_acf_fields_by_group'] = [];
function acf_get_field_groups() { return $GLOBALS['_acf_groups']; }
function acf_get_fields( $group ) { $k = is_array($group) ? ($group['key'] ?? '') : $group; return $GLOBALS['_acf_fields_by_group'][$k] ?? []; }
function __( $s, $d = null ) { return $s; }

require_once AGENTMESH_PLUGIN_DIR . 'admin/class-acf-source.php';

$pass = 0; $fail = 0;
function eq($exp,$act,$name){ global $pass,$fail; if($exp===$act){$pass++; echo "✓ $name\n";} else {$fail++; echo "✗ $name (exp ".var_export($exp,true)." got ".var_export($act,true).")\n";} }

$GLOBALS['_acf_groups'] = [ ['key'=>'g1','title'=>'Wine'] ];
$GLOBALS['_acf_fields_by_group'] = [ 'g1' => [
  ['name'=>'quantity_repeater','key'=>'field_qr','label'=>'Quantity Repeater','type'=>'checkbox','choices'=>['bottle'=>'Bottle','box'=>'Box']],
  ['name'=>'grape_variety','key'=>'field_gv','label'=>'Grape Variety','type'=>'text'],
  ['name'=>'gallery','key'=>'field_im','label'=>'Gallery','type'=>'image'],
] ];
$fields = AgentMesh_ACF_Source::addon_fields();
eq( ['quantity_repeater','grape_variety'], array_map(fn($f)=>$f['name'],$fields), 'addon_fields filters to eligible types (image excluded)' );
eq( ['bottle'=>'Bottle','box'=>'Box'], $fields[0]['choices'], 'addon_fields carries choices for choice types' );

$GLOBALS['_acf_groups']=[];
eq( [], AgentMesh_ACF_Source::addon_fields(), 'no groups → empty list' );

require_once AGENTMESH_PLUGIN_DIR . 'admin/class-price-map.php';

$rows = [
  [ 'field'=>'quantity_repeater', 'type'=>'options', 'options'=>[ 'bottle'=>'1.00', 'box'=>'6.00' ] ],
  [ 'field'=>'gift_wrap', 'type'=>'amount', 'amount'=>'10.00' ],
  [ 'field'=>'custom_fee', 'type'=>'price_field', 'price_field'=>'field_abc' ],
];
$json = AgentMesh_Price_Map::rows_to_json( $rows );
eq( json_encode([
  'quantity_repeater'=>['options'=>['bottle'=>'1.00','box'=>'6.00']],
  'gift_wrap'=>['amount'=>'10.00'],
  'custom_fee'=>['price_field'=>'field_abc'],
]), $json, 'rows_to_json builds the three shapes' );
eq( $rows, AgentMesh_Price_Map::json_to_rows( $json ), 'json_to_rows is the inverse of rows_to_json' );
eq( '{}', AgentMesh_Price_Map::rows_to_json( [] ), 'no rows → {}' );
eq( '{}', AgentMesh_Price_Map::rows_to_json( [ ['field'=>'', 'type'=>'amount','amount'=>'5'] ] ), 'blank field skipped' );

$_POST = [ 'agentmesh_addon_hidden_fields' => [ 'grape_variety', 'non_price', '' ] ];
$vals = array_values( array_filter( array_map( 'trim', (array) $_POST['agentmesh_addon_hidden_fields'] ), 'strlen' ) );
eq( 'grape_variety, non_price', implode( ', ', $vals ), 'multiselect array → comma string (blank dropped)' );

echo "\nTotal: ".($pass+$fail)." Passed: $pass Failed: $fail\n";
exit( $fail ? 1 : 0 );
