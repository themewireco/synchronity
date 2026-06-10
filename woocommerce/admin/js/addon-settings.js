/**
 * Synchronity for WooCommerce — assisted add-on price-map builder.
 *
 * Dependency-free, defensive. Renders a rows UI into #agm-pricemap from its
 * data-fields / data-rows attributes and keeps the hidden #agm-pricemap-json
 * input in sync (the value WooCommerce actually saves). A collapsed
 * #agm-pricemap-raw textarea offers raw-JSON editing as an escape hatch.
 */
( function () {
	'use strict';

	function ready( fn ) {
		if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', fn );
		} else {
			fn();
		}
	}

	function parseJSON( str, fallback ) {
		try {
			var v = JSON.parse( str );
			return v == null ? fallback : v;
		} catch ( e ) {
			return fallback;
		}
	}

	function el( tag, attrs, children ) {
		var node = document.createElement( tag );
		if ( attrs ) {
			Object.keys( attrs ).forEach( function ( k ) {
				if ( k === 'style' ) {
					node.setAttribute( 'style', attrs[ k ] );
				} else {
					node[ k ] = attrs[ k ];
				}
			} );
		}
		( children || [] ).forEach( function ( c ) {
			if ( c == null ) { return; }
			node.appendChild( typeof c === 'string' ? document.createTextNode( c ) : c );
		} );
		return node;
	}

	ready( function () {
		var root = document.getElementById( 'agm-pricemap' );
		var hidden = document.getElementById( 'agm-pricemap-json' );
		if ( ! root || ! hidden ) { return; }

		var fields = parseJSON( root.getAttribute( 'data-fields' ), [] );
		if ( ! Array.isArray( fields ) ) { fields = []; }
		var initialRows = parseJSON( root.getAttribute( 'data-rows' ), [] );
		if ( ! Array.isArray( initialRows ) ) { initialRows = []; }

		var raw = document.getElementById( 'agm-pricemap-raw' );
		var toggle = document.getElementById( 'agm-pricemap-toggle' );

		// In-memory row models: { field, type, amount, options:{val:amt}, price_field }.
		var rows = initialRows.map( normalizeRow );

		function normalizeRow( r ) {
			r = r || {};
			return {
				field: r.field || '',
				type: r.type || 'amount',
				amount: r.amount != null ? String( r.amount ) : '',
				options: r.options && typeof r.options === 'object' ? r.options : {},
				price_field: r.price_field || ''
			};
		}

		function findField( name ) {
			for ( var i = 0; i < fields.length; i++ ) {
				if ( fields[ i ] && fields[ i ].name === name ) { return fields[ i ]; }
			}
			return null;
		}

		// Build the JSON object from the row models and sync the hidden input.
		function sync() {
			var obj = {};
			rows.forEach( function ( r ) {
				var field = ( r.field || '' ).trim();
				if ( ! field ) { return; }
				if ( r.type === 'amount' ) {
					obj[ field ] = { amount: String( r.amount || '' ) };
				} else if ( r.type === 'options' ) {
					var opts = {};
					Object.keys( r.options || {} ).forEach( function ( k ) {
						opts[ String( k ) ] = String( r.options[ k ] );
					} );
					obj[ field ] = { options: opts };
				} else if ( r.type === 'price_field' ) {
					obj[ field ] = { price_field: String( r.price_field || '' ) };
				}
			} );
			hidden.value = JSON.stringify( obj );
			if ( raw ) { raw.value = hidden.value; }
		}

		// Field <select>: option text "{label} ({name})", value = name.
		function fieldSelect( current, onChange ) {
			var sel = el( 'select', { style: 'min-width:220px;' } );
			sel.appendChild( el( 'option', { value: '' }, [ '— Select a field —' ] ) );
			fields.forEach( function ( f ) {
				var label = ( f.label || f.name ) + ' (' + f.name + ')';
				var opt = el( 'option', { value: f.name }, [ label ] );
				if ( f.name === current ) { opt.selected = true; }
				sel.appendChild( opt );
			} );
			// Preserve a stale current value not in the field list.
			if ( current && ! findField( current ) ) {
				var stale = el( 'option', { value: current }, [ current ] );
				stale.selected = true;
				sel.appendChild( stale );
			}
			sel.addEventListener( 'change', function () { onChange( sel.value ); } );
			return sel;
		}

		function typeSelect( current, onChange ) {
			var sel = el( 'select', { style: 'min-width:160px;' } );
			[
				[ 'options', 'Per-option fee' ],
				[ 'amount', 'Fixed fee' ],
				[ 'price_field', 'From ACF field' ]
			].forEach( function ( pair ) {
				var opt = el( 'option', { value: pair[ 0 ] }, [ pair[ 1 ] ] );
				if ( pair[ 0 ] === current ) { opt.selected = true; }
				sel.appendChild( opt );
			} );
			sel.addEventListener( 'change', function () { onChange( sel.value ); } );
			return sel;
		}

		// Amount area depends on row type.
		function amountArea( row ) {
			var wrap = el( 'span', { style: 'display:inline-block;vertical-align:top;' } );

			if ( row.type === 'amount' ) {
				var inp = el( 'input', { type: 'number', step: '0.01', value: row.amount || '', style: 'width:120px;' } );
				inp.addEventListener( 'input', function () { row.amount = inp.value; sync(); } );
				wrap.appendChild( inp );
				return wrap;
			}

			if ( row.type === 'price_field' ) {
				var sel = fieldSelect( row.price_field, function ( v ) { row.price_field = v; sync(); } );
				wrap.appendChild( sel );
				return wrap;
			}

			// options
			var def = findField( row.field );
			var choices = def && def.choices && typeof def.choices === 'object' ? def.choices : null;

			if ( choices ) {
				Object.keys( choices ).forEach( function ( value ) {
					var lineLabel = choices[ value ] + ' (' + value + ')';
					var amt = el( 'input', {
						type: 'number', step: '0.01',
						value: row.options[ value ] != null ? row.options[ value ] : '',
						style: 'width:100px;margin-left:6px;'
					} );
					amt.addEventListener( 'input', function () { row.options[ value ] = amt.value; sync(); } );
					wrap.appendChild( el( 'div', { style: 'margin-bottom:4px;' }, [
						el( 'span', { style: 'display:inline-block;min-width:160px;' }, [ lineLabel ] ),
						amt
					] ) );
				} );
				return wrap;
			}

			// No declared choices — allow free value/amount pairs.
			var list = el( 'div', {} );
			function addPair( value, amount ) {
				var valInp = el( 'input', { type: 'text', value: value || '', placeholder: 'option value', style: 'width:140px;' } );
				var amtInp = el( 'input', { type: 'number', step: '0.01', value: amount != null ? amount : '', placeholder: 'amount', style: 'width:100px;margin-left:6px;' } );
				var prevKey = value || '';
				function update() {
					if ( prevKey && prevKey !== valInp.value ) { delete row.options[ prevKey ]; }
					prevKey = valInp.value;
					if ( valInp.value ) { row.options[ valInp.value ] = amtInp.value; }
					sync();
				}
				valInp.addEventListener( 'input', update );
				amtInp.addEventListener( 'input', update );
				var rm = el( 'button', { type: 'button', className: 'button', style: 'margin-left:6px;' }, [ '×' ] );
				var line = el( 'div', { style: 'margin-bottom:4px;' }, [ valInp, amtInp, rm ] );
				rm.addEventListener( 'click', function ( e ) {
					e.preventDefault();
					if ( prevKey ) { delete row.options[ prevKey ]; }
					list.removeChild( line );
					sync();
				} );
				list.appendChild( line );
			}
			Object.keys( row.options || {} ).forEach( function ( v ) { addPair( v, row.options[ v ] ); } );
			var addBtn = el( 'button', { type: 'button', className: 'button' }, [ '+ Add value' ] );
			addBtn.addEventListener( 'click', function ( e ) { e.preventDefault(); addPair( '', '' ); } );
			wrap.appendChild( list );
			wrap.appendChild( addBtn );
			return wrap;
		}

		var table = el( 'table', { className: 'widefat', style: 'max-width:760px;margin-bottom:8px;' } );
		var tbody = el( 'tbody', {} );
		table.appendChild( tbody );

		function renderRow( row ) {
			var tr = el( 'tr', {} );

			var fieldCell = el( 'td', {}, [
				fieldSelect( row.field, function ( v ) {
					row.field = v;
					// Reset option map when the field changes (choices differ).
					if ( row.type === 'options' ) { row.options = {}; }
					redrawAmount();
					sync();
				} )
			] );

			var typeCell = el( 'td', {}, [
				typeSelect( row.type, function ( v ) {
					row.type = v;
					redrawAmount();
					sync();
				} )
			] );

			var amountCell = el( 'td', {} );
			function redrawAmount() {
				amountCell.innerHTML = '';
				amountCell.appendChild( amountArea( row ) );
			}
			redrawAmount();

			var removeBtn = el( 'button', { type: 'button', className: 'button' }, [ 'Remove' ] );
			removeBtn.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				var idx = rows.indexOf( row );
				if ( idx !== -1 ) { rows.splice( idx, 1 ); }
				tbody.removeChild( tr );
				sync();
			} );
			var actionCell = el( 'td', {}, [ removeBtn ] );

			tr.appendChild( fieldCell );
			tr.appendChild( typeCell );
			tr.appendChild( amountCell );
			tr.appendChild( actionCell );
			tbody.appendChild( tr );
		}

		rows.forEach( renderRow );

		var addRowBtn = el( 'button', { type: 'button', className: 'button' }, [ '+ Add a priced add-on field' ] );
		addRowBtn.addEventListener( 'click', function ( e ) {
			e.preventDefault();
			var row = normalizeRow( {} );
			rows.push( row );
			renderRow( row );
		} );

		root.appendChild( table );
		root.appendChild( addRowBtn );

		// Raw-JSON escape hatch.
		if ( toggle && raw ) {
			toggle.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				raw.style.display = raw.style.display === 'none' ? '' : 'none';
			} );
			raw.addEventListener( 'change', function () {
				hidden.value = raw.value;
			} );
			raw.addEventListener( 'input', function () {
				hidden.value = raw.value;
			} );
		}

		sync();
	} );
} )();
