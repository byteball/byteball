'use strict';

var constants = require('byteballcore/constants.js');
var eventBus = require('byteballcore/event_bus.js');
var ValidationUtils = require('byteballcore/validation_utils.js');
var objectHash = require('byteballcore/object_hash.js');

angular.module('copayApp.services').factory('correspondentListService', function($state, $rootScope, $sce, $compile, configService, storageService, profileService, go, lodash, $stickyState) {
	var root = {};
	var device = require('byteballcore/device.js');
	var chatStorage = require('byteballcore/chat_storage.js');
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
		if (bIncoming) {
			if (peer_address in $rootScope.newMessagesCount)
				$rootScope.newMessagesCount[peer_address]++;
			else {
				$rootScope.newMessagesCount[peer_address] = 1;
			}
			if ($rootScope.newMessagesCount[peer_address] == 1 && (!$state.is('correspondentDevices.correspondentDevice') || root.currentCorrespondent.device_address != peer_address)) {
				root.messageEventsByCorrespondent[peer_address].push({
					bIncoming: false,
					message: 'new messages',
					type: 'system',
					new_message_delim: true
				});
			}
		}
		root.messageEventsByCorrespondent[peer_address].push({
			bIncoming: bIncoming,
			message: body,
			timestamp: Math.floor(Date.now() / 1000)
		});
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
			return '<a ng-click="sendPayment(\''+address+'\')">'+address+'</a>';
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
			var paymentJson = Buffer(paymentJsonBase64, 'base64').toString('utf8');
			console.log(description);
			console.log(paymentJson);
			try{
				var objMultiPaymentRequest = JSON.parse(paymentJson);
			}
			catch(e){
				return '[invalid payment request]';
			}
			if (objMultiPaymentRequest.definitions){
				for (var destinationAddress in objMultiPaymentRequest.definitions){
					var arrDefinition = objMultiPaymentRequest.definitions[destinationAddress].definition;
					if (destinationAddress !== objectHash.getChash160(arrDefinition))
						return '[invalid payment request]';
				}
			}
			try{
				var assocPaymentsByAsset = getPaymentsByAsset(objMultiPaymentRequest);
			}
			catch(e){
				return '[invalid payment request]';
			}
			var arrMovements = [];
			for (var asset in assocPaymentsByAsset)
				arrMovements.push(getAmountText(assocPaymentsByAsset[asset], asset));
			description = 'Payment request: '+arrMovements.join(', ');
			return '<a ng-click="sendMultiPayment(\''+paymentJsonBase64+'\')">'+description+'</a>';
		});
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
					if (feed_name === 'timestamp' && relation === '>')
						return 'after ' + ((typeof value === 'number') ? new Date(value).toString() : value);
					return 'Oracle '+arrAddresses.join(', ')+' posted '+feed_name+' '+relation+' '+value;
				case 'in merkle':
					var arrAddresses = args[0];
					var feed_name = args[1];
					var value = args[2];
					return 'A proof is provided that oracle '+arrAddresses.join(', ')+' posted '+value+' in '+feed_name;
				case 'has':
					if (args.what === 'output' && args.asset && args.amount_at_least && args.address)
						return 'sends at least ' + getAmountText(args.amount_at_least, args.asset) + ' to ' + (arrMyAddresses.indexOf(args.address) >=0 ? 'you' : args.address);
					return JSON.stringify(arrSubdefinition);
				case 'seen':
					if (args.what === 'output' && args.asset && args.amount && args.address){
						var bOwnAddress = (arrMyAddresses.indexOf(args.address) >= 0);
						var dest_address = (bOwnAddress ? 'you' : args.address);
						var expected_payment = getAmountText(args.amount, args.asset) + ' to ' + dest_address;
						return 'there was a transaction that sends ' + ((bWithLinks && !bOwnAddress) ? ('<a ng-click="sendPayment(\''+args.address+'\', '+args.amount+', \''+args.asset+'\')">'+expected_payment+'</a>') : expected_payment);
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

	function loadMoreHistory(correspondent, cb) {
		if (correspondent.endOfChatHistory)
			return;
		if (!root.messageEventsByCorrespondent[correspondent.device_address])
			root.messageEventsByCorrespondent[correspondent.device_address] = [];
		var messageEvents = root.messageEventsByCorrespondent[correspondent.device_address];
		var limit = 10;
		var last_msg_ts = null;
		var last_msg_id = Number.MAX_SAFE_INTEGER;
		if (messageEvents.length && messageEvents[0].id) {
			last_msg_ts = new Date(messageEvents[0].timestamp * 1000);
			last_msg_id = messageEvents[0].id;
		}
		chatStorage.load(correspondent.device_address, last_msg_id, limit, function(messages){
			if (messages.length < limit)
				correspondent.endOfChatHistory = true;
			for (var i in messages) {
				var message = messages[i];
				var msg_ts = new Date(message.creation_date.replace(' ', 'T'));
				if (last_msg_ts && last_msg_ts.getDay() != msg_ts.getDay()) {
					messageEvents.unshift({type: 'system', bIncoming: false, message: last_msg_ts.toDateString(), timestamp: Math.floor(msg_ts.getTime() / 1000)});	
				}
				last_msg_ts = msg_ts;
				messageEvents.unshift({id: message.id, type: message.type, bIncoming: message.is_incoming, message: message.message, timestamp: Math.floor(msg_ts.getTime() / 1000)});
			}
			$rootScope.$digest();
			if (cb) cb();
		});
	}
		
	console.log("correspondentListService");
	
	eventBus.on("text", function(from_address, body){
		mutex.lock(["handle_message"], function(unlock){
			device.readCorrespondent(from_address, function(correspondent){
				if (!root.messageEventsByCorrespondent[correspondent.device_address]) loadMoreHistory(correspondent);
				addIncomingMessageEvent(correspondent.device_address, body);
				if (correspondent.my_record_pref && correspondent.peer_record_pref) chatStorage.store(from_address, body, 1);
				unlock();
			});
		});
		
	});

	eventBus.on("chat_recording_pref", function(correspondent_address, enabled){
		mutex.lock(["handle_message"], function(unlock){
			var bEnabled = (enabled == "true");
			device.readCorrespondent(correspondent_address, function(correspondent){
				var oldState = (correspondent.peer_record_pref && correspondent.my_record_pref);
				correspondent.peer_record_pref = bEnabled;
				var newState = (correspondent.peer_record_pref && correspondent.my_record_pref);
				device.updateCorrespondentProps(correspondent);
				if (newState != oldState) {
					if (!root.messageEventsByCorrespondent[correspondent_address]) root.messageEventsByCorrespondent[correspondent_address] = [];
					var message = {
						type: 'system',
						message: JSON.stringify({state: newState}),
						timestamp: Math.floor(Date.now() / 1000)
					};
					root.messageEventsByCorrespondent[correspondent_address].push(chatStorage.parseMessage(message));
					$rootScope.$digest();
					chatStorage.store(correspondent_address, JSON.stringify({state: newState}), 0, 'system');
				}
				if (root.currentCorrespondent && root.currentCorrespondent.device_address == correspondent_address) {
					root.currentCorrespondent.peer_record_pref = enabled == "true" ? 1 : 0;
				}
				unlock();
			});
			/*if (enabled == "false") {
				chatStorage.purge(correspondent_address);
			}*/
			//root.messageEventsByCorrespondent[correspondent_address] = [];
		});
	});
	
	eventBus.on("sent_payment", function(peer_address, amount, asset){
		setCurrentCorrespondent(peer_address, function(bAnotherCorrespondent){
			var body = '<a ng-click="showPayment(\''+asset+'\')" class="payment">Payment: '+getAmountText(amount, asset)+'</a>';
			addMessageEvent(false, peer_address, body);
			device.readCorrespondent(peer_address, function(correspondent){
				if (correspondent.my_record_pref && correspondent.peer_record_pref) chatStorage.store(peer_address, body, false);
			});
			go.path('correspondentDevices.correspondentDevice');
		});
	});
	
	eventBus.on("received_payment", function(peer_address, amount, asset){
		var body = '<a ng-click="showPayment(\''+asset+'\')" class="payment">Payment: '+getAmountText(amount, asset)+'</a>';
		addMessageEvent(true, peer_address, body);
		device.readCorrespondent(peer_address, function(correspondent){
			if (correspondent.my_record_pref && correspondent.peer_record_pref) chatStorage.store(peer_address, body, false);
		});
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
	
	$rootScope.$on('Local/CorrespondentInvitation', function(event, device_pubkey, device_hub, pairing_secret){
		console.log('CorrespondentInvitation', device_pubkey, device_hub, pairing_secret);
		root.acceptInvitation(device_hub, device_pubkey, pairing_secret, function(){});
	});

	
	root.getPaymentsByAsset = getPaymentsByAsset;
	root.getAmountText = getAmountText;
	root.setCurrentCorrespondent = setCurrentCorrespondent;
	root.formatOutgoingMessage = formatOutgoingMessage;
	root.getHumanReadableDefinition = getHumanReadableDefinition;
	root.loadMoreHistory = loadMoreHistory;
	
	root.list = function(cb) {
	  device.readCorrespondents(function(arrCorrespondents){
		  cb(null, arrCorrespondents);
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
