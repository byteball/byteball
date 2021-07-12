'use strict';

var constants = require('ocore/constants.js');
var eventBus = require('ocore/event_bus.js');
var ValidationUtils = require('ocore/validation_utils.js');
var objectHash = require('ocore/object_hash.js');

angular.module('copayApp.services').factory('correspondentListService', function($state, $rootScope, $sce, $compile, configService, storageService, profileService, go, lodash, $stickyState, $deepStateRedirect, $timeout, gettext, isCordova, pushNotificationsService) {
	var root = {};
	var crypto = require('crypto');
	var device = require('ocore/device.js');
	var wallet = require('ocore/wallet.js');
	var chatStorage = require('ocore/chat_storage.js');

	$rootScope.newMessagesCount = {};
	$rootScope.newMsgCounterEnabled = false;
	$rootScope.newPaymentsCount = {};
	$rootScope.newPaymentsDetails = {};

	if (typeof nw !== 'undefined') {
		var messagesCount;
		var paymentsCount;
		var win = nw.Window.get();
		win.on('focus', function(){
			$rootScope.newMsgCounterEnabled = false;
		});
		win.on('blur', function(){
			$rootScope.newMsgCounterEnabled = true;
		});

		$rootScope.$watch('newMessagesCount', function(counters) {
			messagesCount = lodash.sum(lodash.values(counters));
			if (messagesCount || paymentsCount) {
				win.setBadgeLabel(""+ (messagesCount + paymentsCount));
			} else {
				win.setBadgeLabel("");
			}
		}, true);

		$rootScope.$watch('newPaymentsCount', function(counters) {
			paymentsCount = lodash.sum(lodash.values(counters));
			if (paymentsCount || messagesCount) {
				win.setBadgeLabel(""+ (messagesCount + paymentsCount));
			} else {
				win.setBadgeLabel("");
			}
		}, true);
	}

	$rootScope.$watch('newMessagesCount', function(counters) {
		$rootScope.totalNewMsgCnt = lodash.sum(lodash.values(counters));
	}, true);

	$rootScope.$watch('newPaymentsCount', function(counters) {
		$rootScope.totalNewPaymentsCnt = lodash.sum(lodash.values(counters));
	}, true);


	
	function addIncomingMessageEvent(from_address, in_body, message_counter){
		var walletGeneral = require('ocore/wallet_general.js');
		walletGeneral.readMyPersonalAddresses(function(arrMyAddresses){
			var body = highlightActions(escapeHtml(in_body), arrMyAddresses);
			body.text = text2html(body.text);
			console.log("body with markup: "+body.text);
			addMessageEvent(true, from_address, body, message_counter);
		});
	}
	
	function addMessageEvent(bIncoming, peer_address, body, message_counter, skip_history_load, type){
		if (!root.messageEventsByCorrespondent[peer_address] && !skip_history_load) {
			return loadMoreHistory({device_address: peer_address}, function() {
				addMessageEvent(bIncoming, peer_address, body, message_counter, true, type);
			});
		}
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
					message: '<span class=\"system-span\">new messages</span>',
					type: 'system',
					new_message_delim: true
				});
			}
		}
		var msg_obj = {
			bIncoming: bIncoming,
			message: body,
			timestamp: Math.floor(Date.now() / 1000),
			message_counter: message_counter,
			type: type
		};
		checkAndInsertDate(root.messageEventsByCorrespondent[peer_address], msg_obj);
		insertMsg(root.messageEventsByCorrespondent[peer_address], msg_obj);
		root.assocLastMessageDateByCorrespondent[peer_address] = new Date().toISOString().substr(0, 19).replace('T', ' ');
		if ($state.is('walletHome') && $rootScope.tab == 'walletHome') {
			setCurrentCorrespondent(peer_address, function(bAnotherCorrespondent){
				$timeout(function(){
					$stickyState.reset('correspondentDevices.correspondentDevice');
					go.path('correspondentDevices.correspondentDevice');
				});
			});
		}
		else
			$timeout(function(){
				$rootScope.$digest();
			});
	}

	function insertMsg(messages, msg_obj) {
		for (var i = messages.length-1; i >= 0 && msg_obj.message_counter; i--) {
			var message = messages[i];
			if (!message.message_counter || message.message_counter && msg_obj.message_counter > message.message_counter) {
				messages.splice(i+1, 0, msg_obj);
				return;
			}
		}
		messages.push(msg_obj);
	}
	
	
	// payment description within [] is ignored and whole URI is capturing group
	var payment_request_regexp = /\[.*?\]\(((?:byteball-tn|byteball|obyte-tn|obyte):([0-9A-Z]{32})(?:\?([\w=&;+%]+))?)\)/g;
	var pairing_regexp = /\[.*?\]\(((?:byteball-tn|byteball|obyte-tn|obyte):([\w\/+]{44})@([\w.:\/-]+)#(.+))\)/g;
	var textcoin_regexp = /\[.*?\]\(((?:byteball-tn|byteball|obyte-tn|obyte):textcoin\?([a-z-]+))\)/g;
	var data_regexp = /\[.*?\]\(((?:byteball-tn|byteball|obyte-tn|obyte):data\?(.+))\)/g;
	var url_regexp = /\bhttps?:\/\/[\w+&@#/%?=~|!:,.;-]+[\w+&@#/%=~|-]/g;

	function paymentDropdown(address) {
		return '<a dropdown-toggle="#pop'+address+'">'+address+'</a><ul id="pop'+address+'" class="f-dropdown pop-custom-dropdown" style="left:0px" data-dropdown-content><li><a ng-click="sendPayment(\''+address+'\')"><i class="icon-paperplane size-16"></i> '+gettext('Pay to this address')+'</a></li><li><a ng-click="offerContract(\''+address+'\')"><i class="svg-icon icon-smart-contract"></i> '+gettext('Offer smart contract')+'</a></li><li><a ng-click="offerProsaicContract(\''+address+'\')"><i class="svg-icon icon-contract"></i> '+gettext('Offer prosaic contract')+'</a></li><li><a ng-click="offerArbiterContract(\''+address+'\')"><i class="svg-icon icon-scales"></i> '+gettext('Offer contract with arbitration')+'</a></li></ul>';
	}

	function getContractStatusEmoji(status, me_is_winner) {
		switch (status) {
			case "accepted":
				return "✔️";
			case "declined":
				return "✖️";
			case "cancelled":
				return "❌";
			case "signed":
				return "📝";
			case "paid":
				return "💰";
			case "in_dispute":
			case "in_appeal":
				return "⚖️";
			case "dispute_resolved":
				if (me_is_winner)
					return "⚖️✅";
				else
					return "⚖️❌";
			case "appeal_approved":
				return "⚖️✅";
			case "appeal_declined":
				return "⚖️❌";
			case "completed":
				return "✅";
			default:
				return "";
		}
	}

	function highlightActions(text, arrMyAddresses){
		var URI = require('ocore/uri.js');
	//	return text.replace(/\b[2-7A-Z]{32}\b(?!(\?(amount|asset|device_address|base64data|from_address|single_address)|"))/g, function(address){
		var params = [];
		var param_index = -1;
		var assocReplacements = {};
		var index = crypto.randomBytes(4).readUInt32BE(0);
		function toDelayedReplacement(new_text) {
			index++;
			var key = '{' + index + '}';
			assocReplacements[key] = new_text;
			return key;
		}
		var text = text.replace(/(.*?\b|^)([2-7A-Z]{32})([\s.,;!:].*?|$)/g, function(str, pre, address, post){
			if (!ValidationUtils.isValidAddress(address))
				return str;
			if (pre.lastIndexOf(')') < pre.lastIndexOf(']('))
				return str;
			if (post.indexOf('](') < post.indexOf('[') || (post.indexOf('](') > -1) && (post.indexOf('[') == -1))
				return str;
			if (arrMyAddresses.indexOf(address) >= 0)
				return str;
			//return '<a send-payment address="'+address+'">'+address+'</a>';
			index++;
			var key = '{' + index + '}';
			assocReplacements[key] = paymentDropdown(address);
			return pre+key+post;
		//	return '<a ng-click="sendPayment(\''+address+'\')">'+address+'</a>';
			//return '<a send-payment ng-click="sendPayment(\''+address+'\')">'+address+'</a>';
			//return '<a send-payment ng-click="console.log(\''+address+'\')">'+address+'</a>';
			//return '<a onclick="console.log(\''+address+'\')">'+address+'</a>';
		}).replace(payment_request_regexp, function(str, uri, address, query_string){
			if (!ValidationUtils.isValidAddress(address))
				return str;
		//	if (arrMyAddresses.indexOf(address) >= 0)
		//		return str;
			var objPaymentRequest = parsePaymentRequestQueryString(query_string);
			if (!objPaymentRequest) {
				return toDelayedReplacement(paymentDropdown(address));
			}
			return toDelayedReplacement('<a ng-click="sendPayment(\''+address+'\', '+objPaymentRequest.amount+', \''+objPaymentRequest.asset+'\', \''+objPaymentRequest.device_address+'\', \''+objPaymentRequest.base64data+'\', \''+objPaymentRequest.from_address+'\', \''+objPaymentRequest.single_address+'\')">'+objPaymentRequest.amountStr+'</a>');
		}).replace(pairing_regexp, function(str, uri, device_pubkey, hub, pairing_code){
			param_index++;
			params[param_index] = uri;
			return toDelayedReplacement('<a ng-click="handleUri(messageEvent.message.params[' + param_index + '])">[Pair with device: '+device_pubkey+'@'+hub+'#'+pairing_code+']</a>');
		}).replace(textcoin_regexp, function(str, uri, mnemonic){
			return toDelayedReplacement('<a ng-click="handleUri(\''+uri+'\')">[Claim textcoin: '+mnemonic+']</a>');
		}).replace(data_regexp, function(str, uri, query_string){
			var assocParams = query_string ? URI.parseQueryString(query_string, '&amp;') : null;
			if (!assocParams)
				return str;
			param_index++
			params[param_index] = uri;
			return toDelayedReplacement('<a ng-click="handleUri(messageEvent.message.params[' + param_index + '])">[Send data: '+JSON.stringify(assocParams, null, 2)+']</a>');
		}).replace(/\[(.+?)\]\(suggest-command:(.+?)\)/g, function(str, description, command){
			param_index++
			params[param_index] = command;
			return toDelayedReplacement('<a ng-click="suggestCommand(messageEvent.message.params[' + param_index + '])" class="suggest-command">'+description+'</a>');
		}).replace(/\[(.+?)\]\(command:(.+?)\)/g, function(str, description, command){
			param_index++
			params[param_index] = command;
			return toDelayedReplacement('<a ng-click="sendCommand(messageEvent.message.params[' + param_index + '])" class="command">'+description+'</a>');
		}).replace(/\[(.+?)\]\(payment:([\w\/+=]+?)\)/g, function(str, description, paymentJsonBase64){
			var arrMovements = getMovementsFromJsonBase64PaymentRequest(paymentJsonBase64, true);
			if (!arrMovements)
				return '[invalid payment request]';
			description = 'Payment request: '+arrMovements.join(', ');
			return toDelayedReplacement('<a ng-click="sendMultiPayment(\''+paymentJsonBase64+'\')">'+description+'</a>');
		}).replace(/\[(.+?)\]\(vote:([\w\/+=]+?)\)/g, function(str, description, voteJsonBase64){
			var objVote = getVoteFromJsonBase64(voteJsonBase64);
			if (!objVote)
				return '[invalid vote request]';
			return toDelayedReplacement('<a ng-click="sendVote(\''+voteJsonBase64+'\')">'+escapeHtml(objVote.choice)+'</a>');
		}).replace(/\[(.+?)\]\(profile:([\w\/+=]+?)\)/g, function(str, description, privateProfileJsonBase64){
			var objPrivateProfile = getPrivateProfileFromJsonBase64(privateProfileJsonBase64);
			if (!objPrivateProfile)
				return '[invalid profile]';
			return toDelayedReplacement('<a ng-click="acceptPrivateProfile(\''+privateProfileJsonBase64+'\')">[Profile of '+escapeHtml(objPrivateProfile._label)+']</a>');
		}).replace(/\[(.+?)\]\(pairing-code:(.+?)\)/g, function(str, description, isPermanent){
			isPermanent = isPermanent === "true";
			return toDelayedReplacement('<a ng-click="sendPairingCode('+(isPermanent ? 'true' : 'false') + ')">[Send '+(isPermanent?'permanent ':'')+'pairing code]</a>');
		}).replace(/\[(.+?)\]\(profile-request:([\w,]+?)\)/g, function(str, description, fields_list){
			return toDelayedReplacement('<a ng-click="choosePrivateProfile(\''+escapeQuotes(fields_list)+'\')">[Request for profile]</a>');
		}).replace(/\[(.+?)\]\(sign-message-request(-network-aware)?:(.+?)\)/g, function(str, description, network_aware, message_to_sign){
			param_index++
			params[param_index] = message_to_sign;
			return toDelayedReplacement('<a ng-click="showSignMessageModal(messageEvent.message.params[' + param_index + '], '+!!network_aware+')">[Request to sign message: '+tryParseBase64(message_to_sign)+']</a>');
		}).replace(/\[(.+?)\]\(signed-message:([\w\/+=]+?)\)/g, function(str, description, signedMessageBase64){
			var info = getSignedMessageInfoFromJsonBase64(signedMessageBase64);
			if (!info)
				return '<i>[invalid signed message]</i>';
			var objSignedMessage = info.objSignedMessage;
			var displayed_signed_message = (typeof objSignedMessage.signed_message === 'string') ? objSignedMessage.signed_message : JSON.stringify(objSignedMessage.signed_message);
			var text = 'Message signed by '+objSignedMessage.authors[0].address+': '+escapeHtml(displayed_signed_message);
			if (info.bValid)
				text += " (valid)";
			else if (info.bValid === false)
				text += " (invalid)";
			else
				text += ' (verify)';
			return toDelayedReplacement('<a ng-click="verifySignedMessage(\''+signedMessageBase64+'\')"><i>['+text+']</i></a>');
		}).replace(url_regexp, function(str){
			param_index++;
			params[param_index] = str;
			return toDelayedReplacement('<a ng-click="$root.openExternalLink(messageEvent.message.params[' + param_index + '])" class="external-link">' + str + '</a>');
		}).replace(/\(prosaic-contract:([\w\/+=]+?)\)/g, function(str, contractJsonBase64){
			var objContract = getProsaicContractFromJsonBase64(contractJsonBase64);
			if (!objContract)
				return '[invalid contract]';
			return toDelayedReplacement('<a ng-click="showProsaicContractOffer(\''+contractJsonBase64+'\', true)" class="prosaic_contract_offer">[Prosaic contract '+(objContract.status ? escapeHtml(objContract.status) : 'offer')+': '+escapeHtml(objContract.title)+']</a>');
		}).replace(/\(arbiter-contract-offer:(.+?)\)|\(arbiter-contract-event:(.+?)\)/g, function(str, contractJsonBase64offer, contractJsonBase64event){
			var type = contractJsonBase64offer ? 'offer' : 'event';
			var contractJsonBase64 = contractJsonBase64offer || contractJsonBase64event;
			var objContract = getProsaicContractFromJsonBase64(contractJsonBase64);
			if (!objContract)
				return '[invalid contract]';
			params[++param_index] = objContract.hash;
			return toDelayedReplacement('<a ng-click="showArbiterContractOffer(messageEvent.message.params[' + param_index + '])" class="arbiter_contract_'+type+'"><span class="emoji">' + getContractStatusEmoji(objContract.status, objContract.me_is_winner) + '</span> Contract with arbitration '+(type=='offer' ? 'offer' : escapeHtml(objContract.status))+': '+escapeHtml(objContract.title)+'</a>');
		}).replace(/\(arbiter-dispute:(.+?)\)/g, function(str, disputeJsonBase64){
			if (!ValidationUtils.isValidBase64(disputeJsonBase64))
				return null;
			var strJSON = Buffer.from(disputeJsonBase64, 'base64').toString('utf8');
			try{
				var objDispute = JSON.parse(strJSON);
			}
			catch(e){
				return '[invalid dispute request]';
			}
			params[++param_index] = objDispute.contract_hash;
			params[++param_index] = objDispute.contract_hash+'\n2.5\nOPTIONAL COMMENT FOR CONTRACT \"' + objDispute.title + '"';
			var asset_name = "GB";
			if (objDispute.service_fee_asset === "base") {
			} else if (objDispute.service_fee_asset === "blackbytes" || objDispute.service_fee_asset === constants.BLACKBYTES_ASSET) {
				asset_name = "GBB";
			} else if (profileService.assetMetadata[objDispute.service_fee_asset]) {
				asset_name = profileService.assetMetadata[objDispute.service_fee_asset].name;
			} else {
				asset_name = objDispute.service_fee_asset || "GB";
			} 
			return toDelayedReplacement('<a ng-click="showDisputeRequest(messageEvent.message.params[' + (param_index-1) + '])" class="prosaic_contract_offer">Dispute request for contract "'+escapeHtml(objDispute.title)+'" [' + escapeHtml(objDispute.contract_hash.substr(0, 8)) + '...]</a><br><br><a ng-click="suggestCommand(messageEvent.message.params[' + param_index + '])" class="suggest-command">Set my service fee for this contract with a comment, format:\nCONTRACT_HASH\nAMOUNT\nOPTIONAL COMMENT FOR PLAINTIFF</a>,<br> where AMOUNT is in ' + escapeHtml(asset_name) + '.<br>Please mention the contract title in your optional comment.');
		});
		for (var key in assocReplacements)
			text = text.replace(key, assocReplacements[key]);
		return { text: text, params: params };
	}
	
	function getMovementsFromJsonBase64PaymentRequest(paymentJsonBase64, bAggregatedByAsset){
		if (!ValidationUtils.isValidBase64(paymentJsonBase64))
			return null;
		var paymentJson = Buffer.from(paymentJsonBase64, 'base64').toString('utf8');
		console.log(paymentJson);
		try{
			var objMultiPaymentRequest = JSON.parse(paymentJson);
		}
		catch(e){
			return null;
		}
		if (!ValidationUtils.isNonemptyArray(objMultiPaymentRequest.payments))
			return null;
		if (!objMultiPaymentRequest.payments.every(function(objPayment){
			return ( ValidationUtils.isValidAddress(objPayment.address) && ValidationUtils.isPositiveInteger(objPayment.amount) && (!objPayment.asset || objPayment.asset === "base" || ValidationUtils.isValidBase64(objPayment.asset, constants.HASH_LENGTH)) );
		}))
			return null;
		if (objMultiPaymentRequest.definitions){
			for (var destinationAddress in objMultiPaymentRequest.definitions){
				var arrDefinition = objMultiPaymentRequest.definitions[destinationAddress].definition;
				try {
					if (destinationAddress !== objectHash.getChash160(arrDefinition))
						return null;
				}
				catch(e){
					console.log(e);
					return null;
				}
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
	
	function getVoteFromJsonBase64(voteJsonBase64){
		if (!ValidationUtils.isValidBase64(voteJsonBase64))
			return null;
		var voteJson = Buffer.from(voteJsonBase64, 'base64').toString('utf8');
		console.log(voteJson);
		try{
			var objVote = JSON.parse(voteJson);
		}
		catch(e){
			return null;
		}
		if (!ValidationUtils.isStringOfLength(objVote.poll_unit, 44) || typeof objVote.choice !== 'string')
			return null;
		return objVote;
	}
	
	function getPrivateProfileFromJsonBase64(privateProfileJsonBase64){
		if (!ValidationUtils.isValidBase64(privateProfileJsonBase64))
			return null;
		var privateProfile = require('ocore/private_profile.js');
		var objPrivateProfile = privateProfile.getPrivateProfileFromJsonBase64(privateProfileJsonBase64);
		if (!objPrivateProfile)
			return null;
		var arrFirstFields = [];
		for (var field in objPrivateProfile.src_profile){
			var value = objPrivateProfile.src_profile[field];
			if (!Array.isArray(value))
				continue;
			arrFirstFields.push(value[0]);
			if (arrFirstFields.length === 2)
				break;
		}
		objPrivateProfile._label = arrFirstFields.join(' ');
		return objPrivateProfile;
	}

	function getProsaicContractFromJsonBase64(strJsonBase64){
		if (!ValidationUtils.isValidBase64(strJsonBase64))
			return null;
		var strJSON = Buffer.from(strJsonBase64, 'base64').toString('utf8');
		try{
			var objProsaicContract = JSON.parse(strJSON);
		}
		catch(e){
			return null;
		}
		return objProsaicContract;
	}
	
	function getSignedMessageInfoFromJsonBase64(signedMessageBase64){
		if (!ValidationUtils.isValidBase64(signedMessageBase64))
			return null;
		var signedMessageJson = Buffer.from(signedMessageBase64, 'base64').toString('utf8');
		console.log(signedMessageJson);
		try{
			var objSignedMessage = JSON.parse(signedMessageJson);
		}
		catch(e){
			return null;
		}
		var info = {
			objSignedMessage: objSignedMessage,
			bValid: undefined
		};
		var validation = require('ocore/validation.js');
		validation.validateSignedMessage(objSignedMessage, function(err){
			info.bValid = !err;
			if (err)
				console.log("validateSignedMessage: "+err);
		});
		return info;
	}

	function tryParseBase64(str) {
		if (!ValidationUtils.isValidBase64(str))
			return str;
		var json = Buffer.from(str, 'base64').toString('utf8');
		try{
			var obj = JSON.parse(json);
		}
		catch(e){
			return str; // it is already escapeHtml'd
		}
		//return escapeHtml(JSON.stringify(obj, null, '\t'));
		return escapeHtml(JSON.stringify(obj));
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
		var URI = require('ocore/uri.js');
		var assocReplacements = {};
		var index = crypto.randomBytes(4).readUInt32BE(0);
		var params = [];
		var param_index = -1;
		function toDelayedReplacement(new_text) {
			index++;
			var key = '{' + index + '}';
			assocReplacements[key] = new_text;
			return key;
		}
		var text = escapeHtmlAndInsertBr(text).replace(payment_request_regexp, function(str, uri, address, query_string){
			if (!ValidationUtils.isValidAddress(address))
				return str;
			var objPaymentRequest = parsePaymentRequestQueryString(query_string);
			if (!objPaymentRequest)
				return toDelayedReplacement(address);
			return toDelayedReplacement('<i>'+objPaymentRequest.amountStr+' to '+address+'</i>');
		}).replace(/\[(.+?)\]\(payment:([\w\/+=]+?)\)/g, function(str, description, paymentJsonBase64){
			var arrMovements = getMovementsFromJsonBase64PaymentRequest(paymentJsonBase64);
			if (!arrMovements)
				return '[invalid payment request]';
			return toDelayedReplacement('<i>Payment request: '+arrMovements.join(', ')+'</i>');
		}).replace(pairing_regexp, function(str, uri, device_pubkey, hub, pairing_code){
			return toDelayedReplacement('<i>Sent pairing code: '+ device_pubkey+'@'+hub+'#'+pairing_code+'</i>');
		}).replace(textcoin_regexp, function(str, uri, mnemonic){
			return toDelayedReplacement('<i>Sent textcoin: '+ mnemonic+'</i>');
		}).replace(data_regexp, function(str, uri, query_string){
			var assocParams = query_string ? URI.parseQueryString(query_string, '&amp;') : null;
			if (!assocParams)
				return str;
			return toDelayedReplacement('<i>Sent data: '+ JSON.stringify(assocParams, null, 2)+'</i>');
		}).replace(/\[(.+?)\]\(vote:([\w\/+=]+?)\)/g, function(str, description, voteJsonBase64){
			var objVote = getVoteFromJsonBase64(voteJsonBase64);
			if (!objVote)
				return '[invalid vote request]';
			return toDelayedReplacement('<i>Vote request: '+escapeHtml(objVote.choice)+'</i>');
		}).replace(/\[(.+?)\]\(profile:([\w\/+=]+?)\)/g, function(str, description, privateProfileJsonBase64){
			var objPrivateProfile = getPrivateProfileFromJsonBase64(privateProfileJsonBase64);
			if (!objPrivateProfile)
				return '[invalid profile]';
			return toDelayedReplacement('<a ng-click="acceptPrivateProfile(\''+privateProfileJsonBase64+'\')">[Profile of '+escapeHtml(objPrivateProfile._label)+']</a>');
		}).replace(/\[(.+?)\]\(profile-request:([\w,]+?)\)/g, function(str, description, fields_list){
			return toDelayedReplacement('[Request for profile fields '+fields_list+']');
		}).replace(/\[(.+?)\]\(sign-message-request:(.+?)\)/g, function(str, description, message_to_sign){
			return toDelayedReplacement('<i>[Request to sign message: '+tryParseBase64(message_to_sign)+']</i>');
		}).replace(/\[(.+?)\]\(signed-message:([\w\/+=]+?)\)/g, function(str, description, signedMessageBase64){
			var info = getSignedMessageInfoFromJsonBase64(signedMessageBase64);
			if (!info)
				return '<i>[invalid signed message]</i>';
			var objSignedMessage = info.objSignedMessage;
			var displayed_signed_message = (typeof objSignedMessage.signed_message === 'string') ? objSignedMessage.signed_message : JSON.stringify(objSignedMessage.signed_message);
			var text = 'Message signed by '+objSignedMessage.authors[0].address+': '+escapeHtml(displayed_signed_message);
			if (info.bValid)
				text += " (valid)";
			else if (info.bValid === false)
				text += " (invalid)";
			else
				text += ' (verify)';
			return toDelayedReplacement('<a ng-click="verifySignedMessage(\''+signedMessageBase64+'\')"><i>['+text+']</i></a>');
		}).replace(url_regexp, function(str){
			param_index++;
			params[param_index] = str;
			return toDelayedReplacement('<a ng-click="$root.openExternalLink(messageEvent.message.params[' + param_index + '])" class="external-link">' + str + '</a>');
		}).replace(/\(prosaic-contract:([\w\/+=]+?)\)/g, function(str, contractJsonBase64){
			var objContract = getProsaicContractFromJsonBase64(contractJsonBase64);
			if (!objContract)
				return '[invalid contract]';
			return toDelayedReplacement('<a ng-click="showProsaicContractOffer(\''+contractJsonBase64+'\', false)" class="prosaic_contract_offer">[Prosaic contract '+(objContract.status ? escapeHtml(objContract.status) : 'offer')+': '+escapeHtml(objContract.title)+']</a>');
		}).replace(/\(arbiter-contract-offer:(.+?)\)|\(arbiter-contract-event:(.+?)\)/g, function(str, contractJsonBase64offer, contractJsonBase64event){
			var type = contractJsonBase64offer ? 'offer' : 'event';
			var contractJsonBase64 = contractJsonBase64offer || contractJsonBase64event;
			var objContract = getProsaicContractFromJsonBase64(contractJsonBase64);
			if (!objContract)
				return '[invalid contract]';
			params[++param_index] = objContract.hash;
			return toDelayedReplacement('<a ng-click="showArbiterContractOffer(messageEvent.message.params[' + param_index + '])" class="arbiter_contract_'+type+'"><span class="emoji">' + getContractStatusEmoji(objContract.status, objContract.me_is_winner) + '</span> Contract with arbitration '+(type=='offer' ? 'offer' : escapeHtml(objContract.status))+': '+escapeHtml(objContract.title)+'</a>');
		});
		for (var key in assocReplacements)
			text = text.replace(key, assocReplacements[key]);
		return {text: text, params: params};
	}
	
	function parsePaymentRequestQueryString(query_string){
		if (!query_string)
			return null;
		var URI = require('ocore/uri.js');
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
		var base64data = assocParams['base64data'] || '';
		if (base64data && !ValidationUtils.isValidBase64(base64data))
			return null;
		var from_address = from_address = assocParams['from_address'] || '';
		var single_address = assocParams['single_address'] || 0;
		if (single_address)
			single_address = single_address.replace(/^single/, ''); // backward compatibility
		if (single_address && ValidationUtils.isValidAddress(single_address)) {
			from_address = String(single_address);
			single_address = 1;
		}
		var amountStr = 'Payment request'+(from_address ? ' for '+from_address: (single_address ? ' for single-address account': ''))+(base64data ? ' with data': '')+': ' + getAmountText(amount, asset);
		return {
			amount: amount,
			asset: asset,
			device_address: device_address,
			base64data: base64data,
			from_address: from_address,
			single_address: single_address,
			amountStr: amountStr
		};
	}
	
	function text2html(text){
		return text.toString().replace(/\r/g, '').replace(/\n/g, '<br>').replace(/\t/g, ' &nbsp; &nbsp; ');
	}
	
	function escapeHtml(text){
		return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
	
	function escapeHtmlAndInsertBr(text){
		return text2html(escapeHtml(text));
	}
	
	function escapeQuotes(text){
		return text.toString().replace(/(['\\])/g, "\\$1").replace(/"/g, "&quot;");
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
		else if (profileService.assetMetadata[asset]){
			amount /= Math.pow(10, profileService.assetMetadata[asset].decimals || 0);
			return amount + ' ' + escapeHtml(profileService.assetMetadata[asset].name);
		}
		else{
			wallet.readAssetMetadata([asset], function(){});
			return amount + ' of ' + asset;
		}
	}
		
	function getHumanReadableDefinition(arrDefinition, arrMyAddresses, arrMyPubKeys, assocPeerNamesByAddress, bWithLinks){
		function getDisplayAddress(address){
			if (arrMyAddresses.indexOf(address) >= 0)
				return '<span title="your address: '+address+'">you</span>';
			if (assocPeerNamesByAddress[address])
				return '<span title="peer address: '+address+'">'+escapeHtml(assocPeerNamesByAddress[address])+'</span>';
			return address;
		}
		function parse(arrSubdefinition){
			var op = arrSubdefinition[0];
			var args = arrSubdefinition[1];
			switch(op){
				case 'sig':
					var pubkey = args.pubkey;
					return 'signed by '+(arrMyPubKeys.indexOf(pubkey) >=0 ? 'you' : 'public key '+escapeHtml(pubkey));
				case 'address':
					var address = args;
					return 'signed by '+getDisplayAddress(address);
				case 'cosigned by':
					var address = args;
					return 'co-signed by '+getDisplayAddress(address);
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
				case 'timestamp':
					var relation = args[0];
					var timestamp = args[1];
					var when = '';
					if (relation === '>' || relation === '>=')
						when = 'after';
					if (relation === '<' || relation === '<=')
						when = 'before';
					if (relation === '=')
						when = 'at';
					if (relation === '!=')
						when = 'not at';
					return when + ' ' + (new Date(timestamp * 1000).toString());
				case 'in data feed':
					var arrAddresses = args[0];
					var feed_name = args[1];
					var relation = args[2];
					var value = args[3];
					var min_mci = args[4];
					if (feed_name === 'timestamp' && relation === '>' && (typeof value === 'number' || parseInt(value).toString() === value))
						return 'after ' + ((typeof value === 'number') ? new Date(value).toString() : new Date(parseInt(value)).toString());
					var str = 'Oracle '+arrAddresses.join(', ')+' posted '+escapeHtml(feed_name)+' '+relation+' '+escapeHtml(value);
					if (min_mci)
						str += ' after MCI '+min_mci;
					return str;
				case 'in merkle':
					var arrAddresses = args[0];
					var feed_name = args[1];
					var value = args[2];
					var min_mci = args[3];
					var str = 'A proof is provided that oracle '+arrAddresses.join(', ')+' posted '+escapeHtml(value)+' in '+escapeHtml(feed_name);
					if (min_mci)
						str += ' after MCI '+min_mci;
					return str;
				case 'has':
					if (args.what === 'output' && args.asset && args.address) {
						if (args.amount_at_least)
							return 'sends at least ' + getAmountText(args.amount_at_least, args.asset) + ' to ' + getDisplayAddress(args.address);
						if (args.amount_at_most)
							return 'sends at most ' + getAmountText(args.amount_at_most, args.asset) + ' to ' + getDisplayAddress(args.address);
						if (args.amount)
							return 'sends ' + getAmountText(args.amount, args.asset) + ' to ' + getDisplayAddress(args.address);
						return 'sends ' + escapeHtml(profileService.getUnitName(args.asset)) + ' to ' + getDisplayAddress(args.address);
					}
					return escapeHtml(JSON.stringify(arrSubdefinition));
				case 'has one':
					if (args.what === 'output' && Object.keys(args).length === 1)
						return 'has only one output';
					return escapeHtml(JSON.stringify(arrSubdefinition));
				case 'seen':
					if (args.what === 'output' && args.asset && args.amount && args.address){
						var dest_address = ((args.address === 'this address') ? objectHash.getChash160(arrDefinition) : args.address);
						var bOwnAddress = (arrMyAddresses.indexOf(args.address) >= 0);
						var expected_payment = getAmountText(args.amount, args.asset) + ' to ' + getDisplayAddress(args.address);
						return 'there was a transaction that sends ' + ((bWithLinks && !bOwnAddress) ? ('<a ng-click="sendPayment(\''+dest_address+'\', '+args.amount+', \''+args.asset+'\')">'+expected_payment+'</a>') : expected_payment);
					}
					else if (args.what === 'input' && (args.asset && args.amount || !args.asset && !args.amount) && args.address){
						var how_much = (args.asset && args.amount) ? getAmountText(args.amount, args.asset) : '';
						return 'there was a transaction that spends '+how_much+' from '+args.address;
					}
					return escapeHtml(JSON.stringify(arrSubdefinition));

				default:
					return escapeHtml(JSON.stringify(arrSubdefinition));
			}
		}
		function parseAndIndent(arrSubdefinition){
			return '<div class="indent">'+parse(arrSubdefinition)+'</div>\n';
		}
		return parse(arrDefinition, 0);
	}

	var historyEndForCorrespondent = {};
	function loadMoreHistory(correspondent, cb) {
		if (historyEndForCorrespondent[correspondent.device_address]) {
			if (cb) cb();
			return;
		}
		if (!root.messageEventsByCorrespondent[correspondent.device_address])
			root.messageEventsByCorrespondent[correspondent.device_address] = [];
		var messageEvents = root.messageEventsByCorrespondent[correspondent.device_address];
		var limit = 40;
		var last_msg_ts = null;
		var last_msg_id = 90071992547411;
		if (messageEvents.length && messageEvents[0].id) {
			last_msg_ts = new Date(messageEvents[0].timestamp * 1000);
			last_msg_id = messageEvents[0].id;
		}
		chatStorage.load(correspondent.device_address, last_msg_id, limit, function(messages){
			for (var i in messages) {
				messages[i] = parseMessage(messages[i]);
			}
			var walletGeneral = require('ocore/wallet_general.js');
			walletGeneral.readMyPersonalAddresses(function(arrMyAddresses){
				if (messages.length < limit)
					historyEndForCorrespondent[correspondent.device_address] = true;
				for (var i in messages) {
					var message = messages[i];
					var msg_ts = new Date(message.creation_date.replace(' ', 'T')+'.000Z');
					if (last_msg_ts && last_msg_ts.getDay() != msg_ts.getDay()) {
						messageEvents.unshift({type: 'system', bIncoming: false, message: "<span class=\"system-span\">" + last_msg_ts.toDateString() + "</span>", timestamp: Math.floor(msg_ts.getTime() / 1000)});	
					}
					last_msg_ts = msg_ts;
					if (message.type == "text" || message.type == "event") {
						if (message.is_incoming) {
							message.message = highlightActions(escapeHtml(message.message), arrMyAddresses);
							message.message.text = text2html(message.message.text);
						} else {
							message.message = formatOutgoingMessage(message.message);
						}
					}
					messageEvents.unshift({id: message.id, type: message.type, bIncoming: message.is_incoming, message: message.message, timestamp: Math.floor(msg_ts.getTime() / 1000), chat_recording_status: message.chat_recording_status});
				}
				if (historyEndForCorrespondent[correspondent.device_address] && messageEvents.length > 1) {
					messageEvents.unshift({type: 'system', bIncoming: false, message: "<span class=\"system-span\">" + (last_msg_ts ? last_msg_ts : new Date()).toDateString() + "</span>", timestamp: Math.floor((last_msg_ts ? last_msg_ts : new Date()).getTime() / 1000)});
				}
				if (cb) cb();
			});
		});
	}

	function checkAndInsertDate(messageEvents, message) {
		if (messageEvents.length == 0 || typeof messageEvents[messageEvents.length-1].timestamp == "undefined") return;

		var msg_ts = new Date(message.timestamp * 1000);
		var last_msg_ts = new Date(messageEvents[messageEvents.length-1].timestamp * 1000);
		if (last_msg_ts.getDay() != msg_ts.getDay()) {
			messageEvents.push({type: 'system', bIncoming: false, message: "<span class=\"system-span\">" + msg_ts.toDateString() + "</span>", timestamp: Math.floor(msg_ts.getTime() / 1000)});	
		}
	}

	function parseMessage(message) {
		switch (message.type) {
			case "system":
				message.message = JSON.parse(message.message);
				message.message = "<span class=\"system-span\">chat recording " + (message.message.state ? "&nbsp;" : "") + "</span><b dropdown-toggle=\"#recording-drop\">" + (message.message.state ? "ON" : "OFF") + "</b><span class=\"system-span padding\"></span>";
				message.chat_recording_status = true;
				break;
		}
		return message;
	}

	var message_signing_key_in_progress;
	function signMessageFromAddress(message, address, signingDeviceAddresses, bNetworkAware, cb) {
		var fc = profileService.focusedClient;
		if (fc.isPrivKeyEncrypted()) {
			profileService.unlockFC(null, function(err) {
				if (err){
					return cb(err.message);
				}
				signMessageFromAddress(message, address, signingDeviceAddresses, bNetworkAware, cb);
			});
			return;
		}
		
		profileService.requestTouchid(function(err) {
			if (err) {
				profileService.lockFC();
				return cb(err);
			}
			
			var current_message_signing_key = crypto.createHash("sha256").update(address + message).digest('base64');
			if (current_message_signing_key === message_signing_key_in_progress){
				return cb("This message signing is already under way");
			}
			message_signing_key_in_progress = current_message_signing_key;
			fc.signMessage(address, message, signingDeviceAddresses, bNetworkAware, function(err, objSignedMessage){
				message_signing_key_in_progress = null;
				if (err){
					return cb(err);
				}
				var signedMessageBase64 = Buffer.from(JSON.stringify(objSignedMessage)).toString('base64');
				cb(null, signedMessageBase64);
			});
		});
	}

	function openInExplorer(unit) {
		var testnet = constants.version.match(/t$/) ? 'testnet' : '';
		var url = 'https://' + testnet + 'explorer.obyte.org/#' + unit;
		go.openExternalLink(url);
	};

	/*eventBus.on("sign_message_from_address", function(message, address, signingDeviceAddresses) {
		signMessageFromAddress(message, address, signingDeviceAddresses, function(err, signedMessageBase64){
			if (signedMessageBase64)
				eventBus.emit("message_signed_from_address", message, address, signedMessageBase64);
		});
	});*/
	
	eventBus.on("text", function(from_address, body, message_counter){
		device.readCorrespondent(from_address, function(correspondent){
			if (!root.messageEventsByCorrespondent[correspondent.device_address]) loadMoreHistory(correspondent);
			addIncomingMessageEvent(correspondent.device_address, body, message_counter);
			if (correspondent.my_record_pref && correspondent.peer_record_pref) chatStorage.store(from_address, body, 1);
		});
	});

	eventBus.on("chat_recording_pref", function(correspondent_address, enabled, message_counter){
		device.readCorrespondent(correspondent_address, function(correspondent){
			var oldState = (correspondent.peer_record_pref && correspondent.my_record_pref);
			correspondent.peer_record_pref = enabled;
			var newState = (correspondent.peer_record_pref && correspondent.my_record_pref);
			device.updateCorrespondentProps(correspondent);
			if (newState != oldState) {
				if (!root.messageEventsByCorrespondent[correspondent_address]) root.messageEventsByCorrespondent[correspondent_address] = [];
				var message = {
					type: 'system',
					message: JSON.stringify({state: newState}),
					timestamp: Math.floor(Date.now() / 1000),
					chat_recording_status: true,
					message_counter: message_counter
				};
				insertMsg(root.messageEventsByCorrespondent[correspondent_address], parseMessage(message));
				$timeout(function(){
					$rootScope.$digest();
				});
				chatStorage.store(correspondent_address, JSON.stringify({state: newState}), 0, 'system');
			}
			if (root.currentCorrespondent && root.currentCorrespondent.device_address == correspondent_address) {
				root.currentCorrespondent.peer_record_pref = enabled ? 1 : 0;
			}
		});
	});

	eventBus.on("sent_payment", function(peer_address, amount, asset, bToSharedAddress){
		var title = bToSharedAddress ? 'Payment to smart address' : 'Payment';
		setCurrentCorrespondent(peer_address, function(bAnotherCorrespondent){
			var body = '<a ng-click="showPayment(\''+asset+'\')" class="payment">'+title+': '+getAmountText(amount, asset)+'</a>';
			addMessageEvent(false, peer_address, body);
			device.readCorrespondent(peer_address, function(correspondent){
				if (correspondent.my_record_pref && correspondent.peer_record_pref) chatStorage.store(peer_address, body, 0, 'html');
			});
			$timeout(function(){
				go.path('correspondentDevices.correspondentDevice');
			});
		});
	});

	eventBus.on("received_payment", function(peer_address, amount, asset, message_counter, type){
		if (type=="watched")
			return;
		var title = type=="shared" ? 'Payment to smart address' : 'Payment';
		var body = '<a ng-click="showPayment(\''+asset+'\')" class="payment">'+title+': '+getAmountText(amount, asset)+'</a>';
		addMessageEvent(true, peer_address, body, message_counter);
		device.readCorrespondent(peer_address, function(correspondent){
			if (correspondent.my_record_pref && correspondent.peer_record_pref) chatStorage.store(peer_address, body, 1, 'html');
		});
	});

	eventBus.on('new_my_transactions', (arrNewUnits) => {
		var storage = require('ocore/storage.js');
		var db = require('ocore/db.js');
			
		arrNewUnits.forEach((unit) => {
			if (unit === $rootScope.sentUnit)
				return;
			if (!$rootScope.newPaymentsCount[unit]) {
				$rootScope.newPaymentsCount[unit] = 1;
				function ifFound(objJoint) {
					$timeout(function(){
						
						var allAddressWithAssets = [];
						var paymentMessages = objJoint.unit.messages.filter(message => message.app === 'payment' && message.payload); // public payments only
						paymentMessages.forEach(message => {
							var outputs = message.payload.outputs;
							outputs.forEach(output =>
								allAddressWithAssets.findIndex(awa => awa.address === output.address) < 0
								&& allAddressWithAssets.push({ address: output.address, asset: message.payload.asset || 'base' })
							);
						});
						var addresses = allAddressWithAssets.map(awa => awa.address);
						var getAssetByAddress = address => allAddressWithAssets.find(awa => awa.address === address).asset;
						db.query(`SELECT address, wallet FROM my_addresses WHERE address IN(?)`, [addresses], rows => {
							var row = rows[0];
							if (row) {
								$rootScope.newPaymentsDetails[unit] = {
									receivedAddress: row.address,
									walletAddress: row.address,
									walletId: row.wallet,
									asset: getAssetByAddress(row.address),
								};
								return $rootScope.$emit('Local/BadgeUpdated');
							}
							// else received payment to a shared address
							db.query(
								`SELECT shared_address, address, wallet 
								FROM shared_addresses
								CROSS JOIN shared_address_signing_paths USING(shared_address)
								CROSS JOIN my_addresses USING(address) 
								WHERE shared_address IN(?)`,
								[addresses],
								rows => {
									var row = rows[0];
									if (!row) {
										delete $rootScope.newPaymentsCount[unit];
										return console.log("failed to find our wallet for payment in unit " + unit);
									}
									$rootScope.newPaymentsDetails[unit] = {
										receivedAddress: row.shared_address,
										walletAddress: row.address,
										walletId: row.wallet,
										asset: getAssetByAddress(row.shared_address),
									};
									$rootScope.$emit('Local/BadgeUpdated');
								}
							);
						});
					});
				};
				function ifNotFound() {
					throw Error("failed to load unit " + unit + " where a payment was received");
				}
				storage.readJoint(db, unit, { ifFound: ifFound, ifNotFound: ifNotFound });
			}
			else
				$rootScope.newPaymentsCount[unit]++;
		});
		delete $rootScope.newPaymentsCount[$rootScope.sentUnit];
	});
	
	eventBus.on('paired', function(device_address){
		pushNotificationsService.pushNotificationsInit();
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
			$timeout(function(){
				$rootScope.$digest();
			});
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
		$deepStateRedirect.reset('correspondentDevices');
		go.path('correspondentDevices');
		$timeout(function(){
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
	root.checkAndInsertDate = checkAndInsertDate;
	root.parseMessage = parseMessage;
	root.escapeHtmlAndInsertBr = escapeHtmlAndInsertBr;
	root.addMessageEvent = addMessageEvent;
	root.getProsaicContractFromJsonBase64 = getProsaicContractFromJsonBase64;
	root.signMessageFromAddress = signMessageFromAddress;
	root.openInExplorer = openInExplorer;
	root.getContractStatusEmoji = getContractStatusEmoji;
	
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
		if (!device.isValidPubKey(device_pubkey))
			return cb("invalid peer public key");
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
	root.assocLastMessageDateByCorrespondent = {};

	return root;
});
