'use strict';

var constants = require('byteballcore/constants.js');
var eventBus = require('byteballcore/event_bus.js');
var ValidationUtils = require('byteballcore/validation_utils.js');
var objectHash = require('byteballcore/object_hash.js');

angular.module('copayApp.services').factory('correspondentListService', function($state, $rootScope, $sce, $compile, configService, storageService, profileService, go, lodash, $stickyState) {
	var root = {};
	var device = require('byteballcore/device.js');
	var wallet = require('byteballcore/wallet.js');
	$rootScope.newMessagesCount = {};
	$rootScope.newMsgCounterEnabled = false;

	if (typeof nw !== 'undefined') {
		var win = nw.Window.get();
		win.on('focus', function(){
			$rootScope.newMsgCounterEnabled = false;
		});
		win.on('blur', function(){
			$rootScope.newMsgCounterEnabled = true;
		});
		$rootScope.$watch('newMessagesCount', function(counters) {
			var sum = lodash.sum(lodash.values(counters));
			if (sum) {
				win.setBadgeLabel(""+sum);
			} else {
				win.setBadgeLabel("");
			}
		}, true);
	}
	$rootScope.$watch('newMessagesCount', function(counters) {
		$rootScope.totalNewMsgCnt = lodash.sum(lodash.values(counters));
	}, true);
	
	function addIncomingMessageEvent(from_address, body){
		var walletGeneral = require('byteballcore/wallet_general.js');
		walletGeneral.readMyAddresses(function(arrMyAddresses){
			body = highlightActions(escapeHtml(body), arrMyAddresses);
			body = text2html(body);
			console.log("body with markup: "+body);
			addMessageEvent(true, from_address, body);
		});
	}
	
	function addMessageEvent(bIncoming, peer_address, body){
		if (!root.messageEventsByCorrespondent[peer_address])
			root.messageEventsByCorrespondent[peer_address] = [];
		//root.messageEventsByCorrespondent[peer_address].push({bIncoming: true, message: $sce.trustAsHtml(body)});
		root.messageEventsByCorrespondent[peer_address].push({bIncoming: bIncoming, message: body});
		if (bIncoming) {
			if (peer_address in $rootScope.newMessagesCount)
				$rootScope.newMessagesCount[peer_address]++;
			else
				$rootScope.newMessagesCount[peer_address] = 1;
		}
		if ($state.is('walletHome') && $rootScope.tab == 'walletHome') {
			setCurrentCorrespondent(peer_address, function(bAnotherCorrespondent){
				$stickyState.reset('correspondentDevices.correspondentDevice');
				go.path('correspondentDevices.correspondentDevice');
			});
		}
		else
			$rootScope.$digest();
	}
	
	var payment_request_regexp = /\[.*?\]\(byteball:([0-9A-Z]{32})\?([\w=&;+%]+)\)/g; // payment description within [] is ignored
	
	function highlightActions(text, arrMyAddresses){
		return text.replace(/\b[2-7A-Z]{32}\b(?!(\?(amount|asset|device_address)|"))/g, function(address){
			if (!ValidationUtils.isValidAddress(address))
				return address;
		//	if (arrMyAddresses.indexOf(address) >= 0)
		//		return address;
			//return '<a send-payment address="'+address+'">'+address+'</a>';
			return '<a dropdown-toggle="#pop'+address+'">'+address+'</a><ul id="pop'+address+'" class="f-dropdown drop-to4p drop-4up" style="left:0px" data-dropdown-content><li><a ng-click="sendPayment(\''+address+'\')">Pay to this address</a></li><li><a ng-click="offerContract(\''+address+'\')">Offer a contract</a></li></ul>';
		//	return '<a ng-click="sendPayment(\''+address+'\')">'+address+'</a>';
			//return '<a send-payment ng-click="sendPayment(\''+address+'\')">'+address+'</a>';
			//return '<a send-payment ng-click="console.log(\''+address+'\')">'+address+'</a>';
			//return '<a onclick="console.log(\''+address+'\')">'+address+'</a>';
		}).replace(payment_request_regexp, function(str, address, query_string){
			if (!ValidationUtils.isValidAddress(address))
				return str;
		//	if (arrMyAddresses.indexOf(address) >= 0)
		//		return str;
			var objPaymentRequest = parsePaymentRequestQueryString(query_string);
			if (!objPaymentRequest)
				return str;
			return '<a ng-click="sendPayment(\''+address+'\', '+objPaymentRequest.amount+', \''+objPaymentRequest.asset+'\', \''+objPaymentRequest.device_address+'\')">'+objPaymentRequest.amountStr+'</a>';
		}).replace(/\[(.+?)\]\(command:(.+?)\)/g, function(str, description, command){
			return '<a ng-click="sendCommand(\''+escapeQuotes(command)+'\', \''+escapeQuotes(description)+'\')" class="command">'+description+'</a>';
		}).replace(/\[(.+?)\]\(payment:(.+?)\)/g, function(str, description, paymentJsonBase64){
			var arrMovements = getMovementsFromJsonBase64PaymentRequest(paymentJsonBase64, true);
			if (!arrMovements)
				return '[invalid payment request]';
			description = 'Payment request: '+arrMovements.join(', ');
			return '<a ng-click="sendMultiPayment(\''+paymentJsonBase64+'\')">'+description+'</a>';
		});
	}
	
	function getMovementsFromJsonBase64PaymentRequest(paymentJsonBase64, bAggregatedByAsset){
		var paymentJson = Buffer(paymentJsonBase64, 'base64').toString('utf8');
		console.log(paymentJson);
		try{
			var objMultiPaymentRequest = JSON.parse(paymentJson);
		}
		catch(e){
			return null;
		}
		if (objMultiPaymentRequest.definitions){
			for (var destinationAddress in objMultiPaymentRequest.definitions){
				var arrDefinition = objMultiPaymentRequest.definitions[destinationAddress].definition;
				if (destinationAddress !== objectHash.getChash160(arrDefinition))
					return null;
			}
		}
		try{
			var assocPaymentsByAsset = getPaymentsByAsset(objMultiPaymentRequest);
		}
		catch(e){
			return null;
		}
		var arrMovements = [];
		if (bAggregatedByAsset)
			for (var asset in assocPaymentsByAsset)
				arrMovements.push(getAmountText(assocPaymentsByAsset[asset], asset));
		else
			arrMovements = objMultiPaymentRequest.payments.map(function(objPayment){
				return getAmountText(objPayment.amount, objPayment.asset || 'base') + ' to ' + objPayment.address;
			});
		return arrMovements;
	}
	
	function getPaymentsByAsset(objMultiPaymentRequest){
		var assocPaymentsByAsset = {};
		objMultiPaymentRequest.payments.forEach(function(objPayment){
			var asset = objPayment.asset || 'base';
			if (asset !== 'base' && !ValidationUtils.isValidBase64(asset, constants.HASH_LENGTH))
				throw Error("asset "+asset+" is not valid");
			if (!ValidationUtils.isPositiveInteger(objPayment.amount))
				throw Error("amount "+objPayment.amount+" is not valid");
			if (!assocPaymentsByAsset[asset])
				assocPaymentsByAsset[asset] = 0;
			assocPaymentsByAsset[asset] += objPayment.amount;
		});
		return assocPaymentsByAsset;
	}
	
	function formatOutgoingMessage(text){
		return escapeHtmlAndInsertBr(text).replace(payment_request_regexp, function(str, address, query_string){
			if (!ValidationUtils.isValidAddress(address))
				return str;
			var objPaymentRequest = parsePaymentRequestQueryString(query_string);
			if (!objPaymentRequest)
				return str;
			return '<i>'+objPaymentRequest.amountStr+' to '+address+'</i>';
		}).replace(/\[(.+?)\]\(payment:(.+?)\)/g, function(str, description, paymentJsonBase64){
			var arrMovements = getMovementsFromJsonBase64PaymentRequest(paymentJsonBase64);
			if (!arrMovements)
				return '[invalid payment request]';
			return '<i>Payment request: '+arrMovements.join(', ')+'</i>';
		});
	}
	
	function parsePaymentRequestQueryString(query_string){
		var URI = require('byteballcore/uri.js');
		var assocParams = URI.parseQueryString(query_string, '&amp;');
		var strAmount = assocParams['amount'];
		if (!strAmount)
			return null;
		var amount = parseInt(strAmount);
		if (amount + '' !== strAmount)
			return null;
		if (!ValidationUtils.isPositiveInteger(amount))
			return null;
		var asset = assocParams['asset'] || 'base';
		console.log("asset="+asset);
		if (asset !== 'base' && !ValidationUtils.isValidBase64(asset, constants.HASH_LENGTH)) // invalid asset
			return null;
		var device_address = assocParams['device_address'] || '';
		if (device_address && !ValidationUtils.isValidDeviceAddress(device_address))
			return null;
		var amountStr = 'Payment request: ' + getAmountText(amount, asset);
		return {
			amount: amount,
			asset: asset,
			device_address: device_address,
			amountStr: amountStr
		};
	}
	
	function text2html(text){
		return text.replace(/\r/g, '').replace(/\n/g, '<br>').replace(/\t/g, ' &nbsp; &nbsp; ');
	}
	
	function escapeHtml(text){
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
	
	function escapeHtmlAndInsertBr(text){
		return text2html(escapeHtml(text));
	}
	
	function escapeQuotes(text){
		return text.replace(/(['\\])/g, "\\$1").replace(/"/, "&quot;");
	}
	
	function setCurrentCorrespondent(correspondent_device_address, onDone){
		if (!root.currentCorrespondent || correspondent_device_address !== root.currentCorrespondent.device_address)
			device.readCorrespondent(correspondent_device_address, function(correspondent){
				root.currentCorrespondent = correspondent;
				onDone(true);
			});
		else
			onDone(false);
	}
	
	// amount is in smallest units
	function getAmountText(amount, asset){
		if (asset === 'base'){
			var walletSettings = configService.getSync().wallet.settings;
			var unitValue = walletSettings.unitValue;
			var unitName = walletSettings.unitName;
			if (amount !== 'all')
				amount /= unitValue;
			return amount + ' ' + unitName;
		}
		else if (asset === constants.BLACKBYTES_ASSET){
			var walletSettings = configService.getSync().wallet.settings;
			var bbUnitValue = walletSettings.bbUnitValue;
			var bbUnitName = walletSettings.bbUnitName;
			amount /= bbUnitValue;
			return amount + ' ' + bbUnitName;
		}
		else
			return amount + ' of ' + asset;
	}
		
	function getHumanReadableDefinition(arrDefinition, arrMyAddresses, arrMyPubKeys, bWithLinks){
		function parse(arrSubdefinition){
			var op = arrSubdefinition[0];
			var args = arrSubdefinition[1];
			switch(op){
				case 'sig':
					var pubkey = args.pubkey;
					return 'signed by '+(arrMyPubKeys.indexOf(pubkey) >=0 ? 'you' : 'public key '+pubkey);
				case 'address':
					var address = args;
					return 'signed by '+(arrMyAddresses.indexOf(address) >=0 ? 'you' : address);
				case 'cosigned by':
					var address = args;
					return 'co-signed by '+(arrMyAddresses.indexOf(address) >=0 ? 'you' : address);
				case 'not':
					return '<span class="size-18">not</span>'+parseAndIndent(args);
				case 'or':
				case 'and':
					return args.map(parseAndIndent).join('<span class="size-18">'+op+'</span>');
				case 'r of set':
					return 'at least '+args.required+' of the following is true:<br>'+args.set.map(parseAndIndent).join(',');
				case 'weighted and':
					return 'the total weight of the true conditions below is at least '+args.required+':<br>'+args.set.map(function(arg){
						return arg.weight+': '+parseAndIndent(arg.value);
					}).join(',');
				case 'in data feed':
					var arrAddresses = args[0];
					var feed_name = args[1];
					var relation = args[2];
					var value = args[3];
					var min_mci = args[4];
					if (feed_name === 'timestamp' && relation === '>')
						return 'after ' + ((typeof value === 'number') ? new Date(value).toString() : value);
					var str = 'Oracle '+arrAddresses.join(', ')+' posted '+feed_name+' '+relation+' '+value;
					if (min_mci)
						str += ' after MCI '+min_mci;
					return str;
				case 'in merkle':
					var arrAddresses = args[0];
					var feed_name = args[1];
					var value = args[2];
					var min_mci = args[3];
					var str = 'A proof is provided that oracle '+arrAddresses.join(', ')+' posted '+value+' in '+feed_name;
					if (min_mci)
						str += ' after MCI '+min_mci;
					return str;
				case 'has':
					if (args.what === 'output' && args.asset && args.amount_at_least && args.address)
						return 'sends at least ' + getAmountText(args.amount_at_least, args.asset) + ' to ' + (arrMyAddresses.indexOf(args.address) >=0 ? 'you' : args.address);
					return JSON.stringify(arrSubdefinition);
				case 'seen':
					if (args.what === 'output' && args.asset && args.amount && args.address){
						var dest_address = ((args.address === 'this address') ? objectHash.getChash160(arrDefinition) : args.address);
						var bOwnAddress = (arrMyAddresses.indexOf(args.address) >= 0);
						var display_dest_address = (bOwnAddress ? 'you' : args.address);
						var expected_payment = getAmountText(args.amount, args.asset) + ' to ' + display_dest_address;
						return 'there was a transaction that sends ' + ((bWithLinks && !bOwnAddress) ? ('<a ng-click="sendPayment(\''+dest_address+'\', '+args.amount+', \''+args.asset+'\')">'+expected_payment+'</a>') : expected_payment);
					}
					return JSON.stringify(arrSubdefinition);

				default:
					return JSON.stringify(arrSubdefinition);
			}
		}
		function parseAndIndent(arrSubdefinition){
			return '<div class="indent">'+parse(arrSubdefinition)+'</div>\n';
		}
		return parse(arrDefinition, 0);
	}		

	console.log("correspondentListService");
	
	eventBus.on("text", function(from_address, body){
		addIncomingMessageEvent(from_address, body);
	});
	
	eventBus.on("sent_payment", function(peer_address, amount, asset){
		setCurrentCorrespondent(peer_address, function(bAnotherCorrespondent){
			var body = '<a ng-click="showPayment(\''+asset+'\')" class="payment">Payment: '+getAmountText(amount, asset)+'</a>';
			addMessageEvent(false, peer_address, body);
			go.path('correspondentDevices.correspondentDevice');
		});
	});
	
	eventBus.on("received_payment", function(peer_address, amount, asset){
		var body = '<a ng-click="showPayment(\''+asset+'\')" class="payment">Payment: '+getAmountText(amount, asset)+'</a>';
		addMessageEvent(true, peer_address, body);
	});
	
	eventBus.on('paired', function(device_address){
		if ($state.is('correspondentDevices'))
			return $state.reload(); // refresh the list
		if (!$state.is('correspondentDevices.correspondentDevice'))
			return;
		if (!root.currentCorrespondent)
			return;
		if (device_address !== root.currentCorrespondent.device_address)
			return;
		// re-read the correspondent to possibly update its name
		device.readCorrespondent(device_address, function(correspondent){
			// do not assign a new object, just update its property (this object was already bound to a model)
			root.currentCorrespondent.name = correspondent.name;
			$rootScope.$digest();
		});
	});

	 eventBus.on('removed_paired_device', function(device_address){
		if ($state.is('correspondentDevices'))
			return $state.reload(); // todo show popup after refreshing the list
		if (!$state.is('correspondentDevices.correspondentDevice'))
		 	return;
		if (!root.currentCorrespondent)
		 	return;
		if (device_address !== root.currentCorrespondent.device_address)
		 	return;
		
		// go back to list of correspondentDevices
		// todo show popup message
		// todo return to correspondentDevices when in edit-mode, too
		go.path('correspondentDevices');
	});
	

	$rootScope.$on('Local/CorrespondentInvitation', function(event, device_pubkey, device_hub, pairing_secret){
		console.log('CorrespondentInvitation', device_pubkey, device_hub, pairing_secret);
		root.acceptInvitation(device_hub, device_pubkey, pairing_secret, function(){});
	});

	
	root.getPaymentsByAsset = getPaymentsByAsset;
	root.getAmountText = getAmountText;
	root.setCurrentCorrespondent = setCurrentCorrespondent;
	root.formatOutgoingMessage = formatOutgoingMessage;
	root.getHumanReadableDefinition = getHumanReadableDefinition;
	
	root.list = function(cb) {
	  device.readCorrespondents(function(arrCorrespondents){
		  cb(null, arrCorrespondents);
	  });
	};

	root.readNotRemovableDevices = function(cb) {
		
		// device addresses used in signing paths are not removable
		wallet.readDeviceAddressesUsedInSigningPaths(function(arrDeviceAddresses){

			cb(null, arrDeviceAddresses);
		});
	};
	
	root.deviceCanBeRemoved = function(device_address) {

		// load device addresses used in signing paths
		wallet.readDeviceAddressesUsedInSigningPaths(function(arrDeviceAddresses){
					
			var ix = arrDeviceAddresses.indexOf(device_address);

			// device is removable when not in list
			return (ix == -1);
		});
	};

	root.startWaitingForPairing = function(cb){
		device.startWaitingForPairing(function(pairingInfo){
			cb(pairingInfo);
		});
	};
	
	root.acceptInvitation = function(hub_host, device_pubkey, pairing_secret, cb){
		//return setTimeout(cb, 5000);
		if (device_pubkey === device.getMyDevicePubKey())
			return cb("cannot pair with myself");
		// the correspondent will be initially called 'New', we'll rename it as soon as we receive the reverse pairing secret back
		device.addUnconfirmedCorrespondent(device_pubkey, hub_host, 'New', function(device_address){
			device.startWaitingForPairing(function(reversePairingInfo){
				device.sendPairingMessage(hub_host, device_pubkey, pairing_secret, reversePairingInfo.pairing_secret, {
					ifOk: cb,
					ifError: cb
				});
			});
			// this continues in parallel
			// open chat window with the newly added correspondent
			device.readCorrespondent(device_address, function(correspondent){
				root.currentCorrespondent = correspondent;
				if (!$state.is('correspondentDevices.correspondentDevice'))
					go.path('correspondentDevices.correspondentDevice');
				else {
					$stickyState.reset('correspondentDevices.correspondentDevice');
					$state.reload();
				}
			});
		});
	};
	
	root.currentCorrespondent = null;
	root.messageEventsByCorrespondent = {};

  /*
  root.remove = function(addr, cb) {
	var fc = profileService.focusedClient;
	root.list(function(err, ab) {
	  if (err) return cb(err);
	  if (!ab) return;
	  if (!ab[addr]) return cb('Entry does not exist');
	  delete ab[addr];
	  storageService.setCorrespondentList(fc.credentials.network, JSON.stringify(ab), function(err) {
		if (err) return cb('Error deleting entry');
		root.list(function(err, ab) {
		  return cb(err, ab);
		});
	  });
	}); 
  };

  root.removeAll = function() {
	var fc = profileService.focusedClient;
	storageService.removeCorrespondentList(fc.credentials.network, function(err) {
	  if (err) return cb('Error deleting correspondentList');
	  return cb();
	});
  };*/

	return root;
});
