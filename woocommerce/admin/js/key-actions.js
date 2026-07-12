/* global AgentMeshKeyActions */
( function () {
	'use strict';

	var cfg = window.AgentMeshKeyActions || {};
	var i18n = cfg.i18n || {};

	var input = document.getElementById( 'agentmesh_connector_key' );
	var gen   = document.getElementById( 'agentmesh_generate_key' );
	var cpy   = document.getElementById( 'agentmesh_copy_key' );
	var fb    = document.getElementById( 'agentmesh_key_feedback' );

	if ( ! input || ! gen || ! cpy || ! fb ) {
		return;
	}

	function setMsg( msg, kind ) {
		fb.textContent = msg;
		fb.style.color = kind === 'ok' ? '#1e7e34' : ( kind === 'warn' ? '#a94442' : '' );
	}

	gen.addEventListener( 'click', function ( e ) {
		e.preventDefault();
		gen.disabled = true;
		setMsg( i18n.generating || '', '' );

		var body = new URLSearchParams();
		body.set( 'action', 'agentmesh_rotate_key' );
		body.set( '_wpnonce', cfg.nonce );

		fetch( cfg.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: body } )
			.then( function ( r ) {
				return r.json().then( function ( j ) {
					return { ok: r.ok, status: r.status, json: j };
				} );
			} )
			.then( function ( res ) {
				if ( res.ok && res.json && res.json.success && res.json.data && res.json.data.new_key ) {
					input.value = res.json.data.new_key;
					input.type  = 'text'; // reveal so the merchant can verify / copy
					setMsg( res.json.data.message || i18n.rotated || '', 'ok' );
				} else {
					var msg = ( res.json && res.json.data && res.json.data.message ) ||
						( ( i18n.rotationFailed || 'Rotation failed' ) + ' (HTTP ' + res.status + ').' );
					setMsg( msg, 'warn' );
				}
			} )
			.catch( function ( err ) {
				setMsg( ( i18n.requestFailed || 'Rotation request failed' ) + ': ' +
					( err && err.message ? err.message : err ), 'warn' );
			} )
			.finally( function () {
				gen.disabled = false;
			} );
	} );

	cpy.addEventListener( 'click', function ( e ) {
		e.preventDefault();
		if ( ! input.value ) {
			setMsg( i18n.noKey || '', 'warn' );
			return;
		}
		var done = function () { setMsg( i18n.copied || '', 'ok' ); };
		var fail = function () { setMsg( i18n.copyFail || '', 'warn' ); };

		if ( navigator.clipboard && navigator.clipboard.writeText ) {
			navigator.clipboard.writeText( input.value ).then( done, fail );
		} else {
			var prev = input.type;
			input.type = 'text';
			input.select();
			try {
				document.execCommand( 'copy' ) ? done() : fail();
			} catch ( _ ) {
				fail();
			}
			input.type = prev;
		}
	} );
}() );
