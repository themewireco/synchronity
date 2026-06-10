<?php
/**
 * Admin settings page HTML template.
 * Used if rendering outside WC Settings tabs (e.g. standalone menu page).
 */

defined( 'ABSPATH' ) || exit;

$gateway_url   = esc_attr( get_option( 'agentmesh_gateway_url', '' ) );
$connector_key = esc_attr( get_option( 'agentmesh_connector_key', '' ) );
$site_id       = esc_html( get_option( 'agentmesh_site_id', '' ) );
$enabled       = get_option( 'agentmesh_enabled', true );
$allow_cart    = get_option( 'agentmesh_allow_cart', true );
$allow_checkout = get_option( 'agentmesh_allow_checkout', true );
$read_only     = get_option( 'agentmesh_read_only', false );
$api_base      = esc_html( get_site_url() . '/wp-json/agentmesh/v1' );
?>
<div class="wrap agentmesh-settings">
	<h1><?php esc_html_e( 'Synchronity for WooCommerce', 'agentmesh-woocommerce' ); ?></h1>
	<p class="description">
		<?php esc_html_e( 'Configure your Synchronity connection. Your connector API is available at:', 'agentmesh-woocommerce' ); ?>
		<code><?php echo $api_base; ?></code>
	</p>

	<?php if ( $site_id ) : ?>
	<div class="notice notice-info inline">
		<p>
			<strong><?php esc_html_e( 'Site ID:', 'agentmesh-woocommerce' ); ?></strong>
			<code><?php echo $site_id; ?></code>
		</p>
	</div>
	<?php endif; ?>

	<form method="post" action="options.php">
		<?php settings_fields( 'agentmesh_settings_group' ); ?>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row">
					<label for="agentmesh_enabled"><?php esc_html_e( 'Enable Synchronity', 'agentmesh-woocommerce' ); ?></label>
				</th>
				<td>
					<input type="checkbox" id="agentmesh_enabled" name="agentmesh_enabled" value="1"
						<?php checked( $enabled ); ?> />
					<p class="description"><?php esc_html_e( 'Enable the Synchronity connector REST API.', 'agentmesh-woocommerce' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row">
					<label for="agentmesh_gateway_url"><?php esc_html_e( 'Gateway URL', 'agentmesh-woocommerce' ); ?></label>
				</th>
				<td>
					<input type="url" id="agentmesh_gateway_url" name="agentmesh_gateway_url"
						value="<?php echo $gateway_url; ?>" class="regular-text" placeholder="https://api.synchronity.app" />
					<p class="description"><?php esc_html_e( 'Base URL of the Synchronity Gateway.', 'agentmesh-woocommerce' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row">
					<label for="agentmesh_connector_key"><?php esc_html_e( 'Connector Key', 'agentmesh-woocommerce' ); ?></label>
				</th>
				<td>
					<input type="password" id="agentmesh_connector_key" name="agentmesh_connector_key"
						value="<?php echo $connector_key; ?>" class="regular-text" autocomplete="off" />
					<p class="description"><?php esc_html_e( 'Shared secret key from your Synchronity dashboard.', 'agentmesh-woocommerce' ); ?></p>
				</td>
			</tr>
		</table>

		<h2><?php esc_html_e( 'Permissions', 'agentmesh-woocommerce' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Allow Cart Management', 'agentmesh-woocommerce' ); ?></th>
				<td>
					<input type="checkbox" name="agentmesh_allow_cart" value="1" <?php checked( $allow_cart ); ?> />
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Allow Checkout Execution', 'agentmesh-woocommerce' ); ?></th>
				<td>
					<input type="checkbox" name="agentmesh_allow_checkout" value="1" <?php checked( $allow_checkout ); ?> />
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Read-Only Mode', 'agentmesh-woocommerce' ); ?></th>
				<td>
					<input type="checkbox" name="agentmesh_read_only" value="1" <?php checked( $read_only ); ?> />
					<p class="description"><?php esc_html_e( 'Restrict to product/manifest reads only.', 'agentmesh-woocommerce' ); ?></p>
				</td>
			</tr>
		</table>

		<?php submit_button( __( 'Save Settings', 'agentmesh-woocommerce' ) ); ?>
	</form>
</div>
