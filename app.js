(function() {

	return {

		currAttempt : 0,

		MAX_ATTEMPTS : 20,

		currPage: 1,

		limitPerPage: 250,

		defaultState: 'loading',

		profileData: {},

		storeUrl: '',

		resources: {
			PROFILE_URI				: '/admin/customers/search.json?query=email:',
			CUSTOMER_URI			: '%@/admin/customers/%@',
			ORDERS_URI				: '%@/admin/orders.json?limit=%@&page=%@',
			ORDER_URI					: '%@/admin/orders/%@'
		},

		requests: {
			'getProfile' : function(email) {
				return this.getRequest(this.storeUrl + this.resources.PROFILE_URI + email);
			},
			'getOrders' : function(param) {
				return this.getRequest(helpers.fmt(this.resources.ORDERS_URI, this.storeUrl, this.limitPerPage, this.currPage));
			}
		},

		events: {
			'app.activated'             : 'init',
			'requiredProperties.ready'  : 'queryShopify',
			'getProfile.done'						: 'handleGetProfile',
			'getOrders.done'						: 'handleGetOrders',
			'click .toggle-address'     : 'toggleAddress',

			'shopifyData.ready': function() {
				// Get 3 most recent orders from requester
				this.profileData.recentOrders = this.profileData.allOrders.slice(0,3);

				this.switchTo('profile', this.profileData);
			}
		},

		requiredProperties : [
			'ticket.requester.email'
		],

		init: function(data){
			if(!data.firstLoad){
				return;
			}

			this.storeUrl = this.checkStoreUrl(this.settings.url);

			this.allRequiredPropertiesExist();
		},

		queryShopify: function(){
			this.switchTo('requesting');
			this.ajax('getProfile', this.ticket().requester().email());
		},

		allRequiredPropertiesExist: function() {
			if (this.requiredProperties.length > 0) {
				var valid = this.validateRequiredProperty(this.requiredProperties[0]);

				// prop is valid, remove from array
				if (valid) {
					this.requiredProperties.shift();
				}

				if (this.requiredProperties.length > 0 && this.currAttempt < this.MAX_ATTEMPTS) {
					if (!valid) {
						++this.currAttempt;
					}

					_.delay(_.bind(this.allRequiredPropertiesExist, this), 100);
					return;
				}
			}

			if (this.currAttempt < this.MAX_ATTEMPTS) {
				this.trigger('requiredProperties.ready');
			} else {
				this.showError(null, this.I18n.t('global.error.data'));
			}
		},

		validateRequiredProperty: function(property) {
			var parts = property.split('.');
			var part = '', obj = this;

			while (parts.length) {
				part = parts.shift();
				try {
					obj = obj[part]();
				} catch (e) {
					return false;
				}
				// check if property is invalid
				if (parts.length > 0 && !_.isObject(obj)) {
					return false;
				}
				// check if value returned from property is invalid
				if (parts.length === 0 && (_.isNull(obj) || _.isUndefined(obj) || obj === '' || obj === 'no')) {
					return false;
				}
			}

			return true;
		},

		getRequest: function(resource) {
			return {
				headers  : {
					'Authorization': 'Basic ' + Base64.encode(this.settings.api_key + ':' + this.settings.password)
				},
				url      : resource,
				method   : 'GET',
				dataType : 'json'
			};
		},

		checkStoreUrl: function(url) {
			// First, lets make sure there is no trailing slash, we'll add one later.
			if (url.slice(-1) === '/') { url = url.slice(0, -1); }
			// Test whether we have a front-controller reference here.
			if (url.indexOf('index.php') === -1)
			{
				// Nothing to do, the front-controller isn't in the url, pass it back unaltered.
				return url;
			}
			url = url.replace(/\/index.php/g, '');
			return url;
		},

		handleGetProfile: function(data) {
			if (data.errors) {
				this.showError(null, data.errors);
				return;
			}

			if (data.customers.length === 0) {
				this.showError(this.I18n.t('global.error.customerNotFound'), " ");
				return;
			}

			this.profileData = data.customers[0];
			this.profileData.allOrders = [];

			if (this.profileData.note === "" || this.profileData.note === null) { 
				this.profileData.note = this.I18n.t('customer.no_notes');
			}

			this.profileData.customer_uri = helpers.fmt(this.resources.CUSTOMER_URI,this.storeUrl,this.profileData.id);

			// Get the shop's orders, currently we can't filter by customer_id/email
			this.ajax('getOrders');
		},

		handleGetOrders: function(data) {
			if (data.errors) {
				this.showError(this.I18n.t('global.error.orders'), data.errors);
				return;
			}

			if (!data.orders.length) {
				// we have probably reached the last page
				this.trigger('shopifyData.ready');
				return;
			}

			// Find this customer's orders from this page's orders
			_.each(data.orders, function(order) {
				if (order.email === this.profileData.email) {
					this.profileData.allOrders.push(this.fmtOrder(order));
				}
			}, this);

			if (this.settings.order_id_field_id) {
				var orderId,
						customFieldName;

				// Get custom field order ID
				customFieldName = 'custom_field_' + this.settings.order_id_field_id;
				orderId = this.ticket().customField(customFieldName);

				if (orderId) {

					// Check if custom field order is in the response
					this.profileData.ticketOrder = _.find(data.orders, function(order){
						return (order.order_number == orderId);
					});

					if (!this.profileData.ticketOrder || this.profileData.allOrders.length < 3) {
						// We haven't got enough data yet, let try another request
						this.currPage++;
						this.ajax('getOrders', orderId);
						return;
					}
				}
			}

			this.trigger('shopifyData.ready');
		},

		fmtOrder: function(order) {
			var newOrder = order;

			newOrder.uri = helpers.fmt(this.resources.ORDER_URI, this.storeUrl, order.id);

			if (!order.fulfillment_status) {
				newOrder.fulfillment_status = "not-fulfilled";
			}

			if (order.note === "" || order.note === null) { 
				newOrder.note = this.I18n.t('customer.no_notes');
			}

			return newOrder;
		},

		toggleAddress: function (e) {
			this.$(e.target).parent().next('p').toggleClass('hide');
			return false;
		},

		showError: function(title, msg) {
			this.switchTo('error', {
				title: title || this.I18n.t('global.error.title'),
				message: msg || this.I18n.t('global.error.message')
			});
		},

		handleFail: function() {
			// Show fail message
			this.showError();
		}

	};

}());