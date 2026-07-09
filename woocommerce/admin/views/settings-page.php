<?php
/**
 * Admin settings page HTML template.
 * Used if rendering outside WC Settings tabs (e.g. standalone menu page).
 */

defined( 'ABSPATH' ) || exit;

$agentmesh_gateway_url   = get_option( 'agentmesh_gateway_url', 'https://api.synchronity.app' );
$agentmesh_connector_key = get_option( 'agentmesh_connector_key', '' );
$agentmesh_site_id       = get_option( 'agentmesh_site_id', '' );
$agentmesh_enabled       = get_option( 'agentmesh_enabled', true );
$agentmesh_allow_cart    = get_option( 'agentmesh_allow_cart', true );
$agentmesh_allow_checkout = get_option( 'agentmesh_allow_checkout', true );
$agentmesh_read_only     = get_option( 'agentmesh_read_only', false );
$agentmesh_api_base      = get_site_url() . '/wp-json/agentmesh/v1';
?>
<div class="wrap agentmesh-settings">
	<h1><?php esc_html_e( 'Synchronity for WooCommerce', 'synchronity-for-woocommerce' ); ?></h1>
	<p class="description">
		<?php esc_html_e( 'Configure your Synchronity connection. Your connector API is available at:', 'synchronity-for-woocommerce' ); ?>
		<code><?php echo esc_url( $agentmesh_api_base ); ?></code>
	</p>

	<?php if ( $agentmesh_site_id ) : ?>
	<div class="notice notice-info inline">
		<p>
			<strong><?php esc_html_e( 'Site ID:', 'synchronity-for-woocommerce' ); ?></strong>
			<code><?php echo esc_html( $agentmesh_site_id ); ?></code>
		</p>
	</div>
	<?php endif; ?>

	<form method="post" action="options.php">
		<?php settings_fields( 'agentmesh_settings_group' ); ?>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row">
					<label for="agentmesh_enabled"><?php esc_html_e( 'Enable Synchronity', 'synchronity-for-woocommerce' ); ?></label>
				</th>
				<td>
					<input type="checkbox" id="agentmesh_enabled" name="agentmesh_enabled" value="1"
						<?php checked( $agentmesh_enabled ); ?> />
					<p class="description"><?php esc_html_e( 'Enable the Synchronity connector REST API.', 'synchronity-for-woocommerce' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row">
					<label for="agentmesh_gateway_url"><?php esc_html_e( 'Gateway URL', 'synchronity-for-woocommerce' ); ?></label>
				</th>
				<td>
					<input type="url" id="agentmesh_gateway_url" name="agentmesh_gateway_url"
						value="<?php echo esc_url( $agentmesh_gateway_url ); ?>" class="regular-text" placeholder="https://api.synchronity.app" />
					<p class="description"><?php esc_html_e( 'Base URL of the Synchronity Gateway.', 'synchronity-for-woocommerce' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row">
					<label for="agentmesh_connector_key"><?php esc_html_e( 'Connector Key', 'synchronity-for-woocommerce' ); ?></label>
				</th>
				<td>
					<input type="password" id="agentmesh_connector_key" name="agentmesh_connector_key"
						value="<?php echo esc_attr( $agentmesh_connector_key ); ?>" class="regular-text" autocomplete="off" />
					<p class="description"><?php esc_html_e( 'Shared secret key from your Synchronity dashboard.', 'synchronity-for-woocommerce' ); ?></p>
				</td>
			</tr>
		</table>

		<h2><?php esc_html_e( 'Permissions', 'synchronity-for-woocommerce' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Allow Cart Management', 'synchronity-for-woocommerce' ); ?></th>
				<td>
					<input type="checkbox" name="agentmesh_allow_cart" value="1" <?php checked( $agentmesh_allow_cart ); ?> />
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Allow Checkout Execution', 'synchronity-for-woocommerce' ); ?></th>
				<td>
					<input type="checkbox" name="agentmesh_allow_checkout" value="1" <?php checked( $agentmesh_allow_checkout ); ?> />
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Read-Only Mode', 'synchronity-for-woocommerce' ); ?></th>
				<td>
					<input type="checkbox" name="agentmesh_read_only" value="1" <?php checked( $agentmesh_read_only ); ?> />
					<p class="description"><?php esc_html_e( 'Restrict to product/manifest reads only.', 'synchronity-for-woocommerce' ); ?></p>
				</td>
			</tr>
		</table>

		<?php submit_button( __( 'Save Settings', 'synchronity-for-woocommerce' ) ); ?>
	</form>
</div>
