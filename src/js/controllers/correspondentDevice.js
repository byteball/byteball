'use strict';


var constants = require('byteballcore/constants.js');

angular.module('copayApp.controllers').controller('correspondentDeviceController',
  function($scope, $rootScope, $timeout, $sce, $modal, configService, profileService, animationService, isCordova, go, correspondentListService, lodash, $deepStateRedirect, $state) {
	
	var self = this;
	console.log("correspondentDeviceController");
	
	var fc = profileService.focusedClient;
	var chatScope = $scope;
	var indexScope = $scope.index;
	$rootScope.tab = $scope.index.tab = 'chat';
	$scope.backgroundColor = fc.backgroundColor;
	var correspondent = correspondentListService.currentCorrespondent;
	$scope.correspondent = correspondent;
	var myPaymentAddress = indexScope.shared_address;
	if (document.chatForm && document.chatForm.message)
		document.chatForm.message.focus();
	
	if (!correspondentListService.messageEventsByCorrespondent[correspondent.device_address])
		correspondentListService.messageEventsByCorrespondent[correspondent.device_address] = [];
	$scope.messageEvents = correspondentListService.messageEventsByCorrespondent[correspondent.device_address];

	$scope.$watch("newMessagesCount['" + correspondent.device_address +"']", function(counter) {
		if (!$scope.newMsgCounterEnabled && $state.includes('correspondentDevices')) $scope.newMessagesCount[$scope.correspondent.device_address] = 0;
	});

	$scope.$on('$stateChangeStart', function(evt, toState, toParams, fromState) {
	    if (toState.name === 'correspondentDevices.correspondentDevice') {
	        $rootScope.tab = $scope.index.tab = 'chat';
	        $scope.newMessagesCount[correspondentListService.currentCorrespondent.device_address] = 0;
	    }
	});

	$scope.send = function() {
		$scope.error = null;
		if (!$scope.message)
			return;
		setOngoingProcess("sending");
		var message = lodash.clone($scope.message); // save in var as $scope.message may disappear while we are sending the message over the network
		var device = require('byteballcore/device.js');
		device.sendMessageToDevice(correspondent.device_address, "text", message, {
			ifOk: function(){
				setOngoingProcess();
				//$scope.messageEvents.push({bIncoming: false, message: $sce.trustAsHtml($scope.message)});
				$scope.messageEvents.push({bIncoming: false, message: correspondentListService.formatOutgoingMessage(message)});
				$scope.message = "";
				$scope.$apply();
			},
			ifError: function(error){
				setOngoingProcess();
				setError(error);
			}
		});
	};
	
	$scope.insertMyAddress = function(){
		if (!fc.credentials.isComplete())
			return $rootScope.$emit('Local/ShowErrorAlert', "The wallet is not approved yet");
		issueNextAddressIfNecessary(appendMyPaymentAddress);
	};
	
	$scope.requestPayment = function(){
		if (!fc.credentials.isComplete())
			return $rootScope.$emit('Local/ShowErrorAlert', "The wallet is not approved yet");
		issueNextAddressIfNecessary(showRequestPaymentModal);
	};
	
	$scope.sendPayment = function(address, amount, asset){
		console.log("will send payment to "+address);
		if (asset && $scope.index.arrBalances.filter(function(balance){ return (balance.asset === asset); }).length === 0){
			console.log("i do not own anything of asset "+asset);
			return;
		}
		go.send(function(){
			//$rootScope.$emit('Local/SetTab', 'send', true);
			$rootScope.$emit('paymentRequest', address, amount, asset, correspondent.device_address);
		});
	};

	$scope.showPayment = function(asset){
		console.log("will show payment in asset "+asset);
		if (!asset)
			throw Error("no asset in showPayment");
		if (asset && $scope.index.arrBalances.filter(function(balance){ return (balance.asset === asset); }).length === 0){
			console.log("i do not own anything of asset "+asset);
			return;
		}
		var assetIndex = lodash.findIndex($scope.index.arrBalances, {asset: asset});
		if (assetIndex < 0)
			throw Error("failed to find asset index of asset "+asset);
		$scope.index.assetIndex = assetIndex;
		go.history();
	};
	

	$scope.sendMultiPayment = function(paymentJsonBase64){
		var async = require('async');
		var db = require('byteballcore/db.js');
		var walletDefinedByAddresses = require('byteballcore/wallet_defined_by_addresses.js');
		var paymentJson = Buffer(paymentJsonBase64, 'base64').toString('utf8');
		console.log("multi "+paymentJson);
		var objMultiPaymentRequest = JSON.parse(paymentJson);
		$rootScope.modalOpened = true;
		var self = this;
		var fc = profileService.focusedClient;
		var ModalInstanceCtrl = function($scope, $modalInstance) {
			var config = configService.getSync();
			var configWallet = config.wallet;
			var walletSettings = configWallet.settings;
			$scope.unitValue = walletSettings.unitValue;
			$scope.unitName = walletSettings.unitName;
			$scope.color = fc.backgroundColor;
			$scope.bDisabled = true;
			var assocSharedDestinationAddresses = {};
			var createMovementLines = function(){
				$scope.arrMovements = objMultiPaymentRequest.payments.map(function(objPayment){
					var text = correspondentListService.getAmountText(objPayment.amount, objPayment.asset || 'base') + ' to ' + objPayment.address;
					if (assocSharedDestinationAddresses[objPayment.address])
						text += ' (smart address, see below)';
					return text;
				});
			};
			if (objMultiPaymentRequest.definitions){
				var arrAllMemberAddresses = [];
				var arrFuncs = [];
				var assocMemberAddressesByDestAddress = {};
				for (var destinationAddress in objMultiPaymentRequest.definitions){
					var arrDefinition = objMultiPaymentRequest.definitions[destinationAddress].definition;
					var arrMemberAddresses = extractAddressesFromDefinition(arrDefinition);
					assocMemberAddressesByDestAddress[destinationAddress] = arrMemberAddresses;
					arrAllMemberAddresses = arrAllMemberAddresses.concat(arrMemberAddresses);
					arrFuncs.push(function(cb){
						walletDefinedByAddresses.validateAddressDefinition(arrDefinition, cb);
					});
				}
				arrAllMemberAddresses = lodash.uniq(arrAllMemberAddresses);
				var findMyAddresses = function(cb){
					db.query(
						"SELECT address FROM my_addresses WHERE address IN(?) \n\
						UNION \n\
						SELECT shared_address AS address FROM shared_addresses WHERE shared_address IN(?)",
						[arrAllMemberAddresses, arrAllMemberAddresses],
						function(rows){
							var arrMyAddresses = rows.map(function(row){ return row.address; });
							for (var destinationAddress in assocMemberAddressesByDestAddress){
								var arrMemberAddresses = assocMemberAddressesByDestAddress[destinationAddress];
								if (lodash.intersection(arrMemberAddresses, arrMyAddresses).length > 0)
									assocSharedDestinationAddresses[destinationAddress] = true;
							}
							createMovementLines();
							$scope.arrHumanReadableDefinitions = [];
							for (var destinationAddress in objMultiPaymentRequest.definitions){
								var arrDefinition = objMultiPaymentRequest.definitions[destinationAddress].definition;
								$scope.arrHumanReadableDefinitions.push({
									destinationAddress: destinationAddress,
									humanReadableDefinition: correspondentListService.getHumanReadableDefinition(arrDefinition, arrMyAddresses, [])
								});
							}
							cb();
						}
					);
				};
				arrFuncs.push(findMyAddresses);
				async.series(arrFuncs, function(err){
					if (err)
						$scope.error = err;
					else
						$scope.bDisabled = false;
					$scope.$apply();
				});
			}
			else
				$scope.bDisabled = false;
			
			function insertSharedAddress(shared_address, arrDefinition, signers, cb){
				db.query("SELECT 1 FROM shared_addresses WHERE shared_address=?", [shared_address], function(rows){
					if (rows.length > 0){
						console.log('shared address '+shared_address+' already known');
						return cb();
					}
					walletDefinedByAddresses.handleNewSharedAddress({address: shared_address, definition: arrDefinition, signers: signers}, {
						ifOk: cb,
						ifError: function(err){
							throw Error('failed to create shared address '+shared_address+': '+err);
						}
					});
				});
			}

			
			$scope.pay = function() {
				console.log('pay');
				
				if (fc.isPrivKeyEncrypted()) {
					profileService.unlockFC(null, function(err) {
						if (err){
							$scope.error = err.message;
							$scope.$apply();
							return;
						}
						$scope.pay();
					});
					return;
				}
				
				profileService.requestTouchid(function(err) {
					if (err) {
						profileService.lockFC();
						$scope.error = err;
						$timeout(function() {
							$scope.$digest();
						}, 1);
						return;
					}
					
					// create shared addresses
					var arrFuncs = [];
					for (var destinationAddress in assocSharedDestinationAddresses){
						(function(){ // use self-invoking function to isolate scope of da and make it different in different iterations
							var da = destinationAddress;
							arrFuncs.push(function(cb){
								var objDefinitionAndSigners = objMultiPaymentRequest.definitions[da];
								insertSharedAddress(da, objDefinitionAndSigners.definition, objDefinitionAndSigners.signers, cb);
							});
						})();
					}
					async.series(arrFuncs, function(){
						// shared addresses inserted, now pay
						var assocOutputsByAsset = {};
						objMultiPaymentRequest.payments.forEach(function(objPayment){
							var asset = objPayment.asset || 'base';
							if (!assocOutputsByAsset[asset])
								assocOutputsByAsset[asset] = [];
							assocOutputsByAsset[asset].push({address: objPayment.address, amount: objPayment.amount});
						});
						var arrNonBaseAssets = Object.keys(assocOutputsByAsset).filter(function(asset){ return (asset !== 'base'); });
						if (arrNonBaseAssets.length > 1){
							$scope.error = 'more than 1 non-base asset not supported';
							$scope.$apply();
							return;
						}
						var asset = (arrNonBaseAssets.length > 0) ? arrNonBaseAssets[0] : null;
						var arrBaseOutputs = assocOutputsByAsset['base'] || [];
						var arrAssetOutputs = asset ? assocOutputsByAsset[asset] : null;
						var arrSigningDeviceAddresses = []; // empty list means that all signatures are required (such as 2-of-2)
						if (fc.credentials.m < fc.credentials.n)
							indexScope.copayers.forEach(function(copayer){
								if (copayer.me || copayer.signs)
									arrSigningDeviceAddresses.push(copayer.device_address);
							});
						var current_multi_payment_key = require('crypto').createHash("sha256").update(paymentJson).digest('base64');
						if (current_multi_payment_key === indexScope.current_multi_payment_key){
							$rootScope.$emit('Local/ShowErrorAlert', "This payment is already under way");
							$modalInstance.dismiss('cancel');
							return;
						}
						indexScope.current_multi_payment_key = current_multi_payment_key;
						var recipient_device_address = lodash.clone(correspondent.device_address);
						fc.sendMultiPayment({
							asset: asset,
							arrSigningDeviceAddresses: arrSigningDeviceAddresses,
							recipient_device_address: recipient_device_address,
							base_outputs: arrBaseOutputs,
							asset_outputs: arrAssetOutputs
						}, function(err){ // can take long if multisig
							delete indexScope.current_multi_payment_key;
							if (err){
								if (chatScope){
									setError(err);
									chatScope.$apply();
								}
								return;
							}
							$rootScope.$emit("NewOutgoingTx");
							var assocPaymentsByAsset = correspondentListService.getPaymentsByAsset(objMultiPaymentRequest);
							for (var asset in assocPaymentsByAsset)
								eventBus.emit('sent_payment', recipient_device_address, assocPaymentsByAsset[asset], asset);
						});
						$modalInstance.dismiss('cancel');
					});
				});
			}; // pay
			

			$scope.cancel = function() {
				$modalInstance.dismiss('cancel');
			};
		};
		
		function extractAddressesFromDefinition(arrDefinition){
			var assocAddresses = {};
			function parse(arrSubdefinition){
				var op = arrSubdefinition[0];
				switch(op){
					case 'address':
					case 'cosigned by':
						assocAddresses[arrSubdefinition[1]] = true;
						break;
					case 'or':
					case 'and':
						arrSubdefinition[1].forEach(parse);
						break;
					case 'r of set':
						arrSubdefinition[1].set.forEach(parse);
						break;
					case 'weighted and':
						arrSubdefinition[1].set.forEach(function(arg){
							parse(arg.value);
						});
						break;
				}
			}
			parse(arrDefinition);
			return Object.keys(assocAddresses);
		}
		
		var modalInstance = $modal.open({
			templateUrl: 'views/modals/multi-payment.html',
			windowClass: animationService.modalAnimated.slideUp,
			controller: ModalInstanceCtrl,
			scope: $scope
		});

		var disableCloseModal = $rootScope.$on('closeModal', function() {
			modalInstance.dismiss('cancel');
		});

		modalInstance.result.finally(function() {
			$rootScope.modalOpened = false;
			disableCloseModal();
			var m = angular.element(document.getElementsByClassName('reveal-modal'));
			m.addClass(animationService.modalAnimated.slideOutDown);
		});
	};
	

	// send a command to the bot
	$scope.sendCommand = function(command, description){
		console.log("will send command "+command);
		$scope.message = command;
		$scope.send();
	};

	$scope.editCorrespondent = function() {
		go.path('correspondentDevices.editCorrespondentDevice');
	};

	function setError(error){
		console.log("send error:", error);
		$scope.error = error;
	}
	
	function issueNextAddressIfNecessary(onDone){
		if (myPaymentAddress) // do not issue new address
			return onDone();
		var walletDefinedByKeys = require('byteballcore/wallet_defined_by_keys.js');
		walletDefinedByKeys.issueOrSelectNextAddress(fc.credentials.walletId, 0, function(addressInfo){
			myPaymentAddress = addressInfo.address; // cache it in case we need to insert again
			onDone();
			$scope.$apply();
		});
	}
	
	function appendText(text){
		if (!$scope.message)
			$scope.message = '';
		if ($scope.message && $scope.message.charAt($scope.message.length - 1) !== ' ')
			$scope.message += ' ';
		$scope.message += text;
		$scope.message += ' ';
		if (!document.chatForm || !document.chatForm.message) // already gone
			return;
		var msgField = document.chatForm.message;
		msgField.focus();
		msgField.selectionStart = msgField.selectionEnd = msgField.value.length;
	}
	
	function appendMyPaymentAddress(){
		appendText(myPaymentAddress);
	}
	
	function showRequestPaymentModal(){
		$rootScope.modalOpened = true;
		var self = this;
		var fc = profileService.focusedClient;
		var ModalInstanceCtrl = function($scope, $modalInstance) {
			var config = configService.getSync();
			var configWallet = config.wallet;
			var walletSettings = configWallet.settings;
			$scope.unitValue = walletSettings.unitValue;
			$scope.unitName = walletSettings.unitName;
			$scope.bbUnitValue = walletSettings.bbUnitValue;
			$scope.bbUnitName = walletSettings.bbUnitName;
			$scope.color = fc.backgroundColor;
			$scope.isCordova = isCordova;
			$scope.buttonLabel = 'Request payment';
			//$scope.selectedAsset = $scope.index.arrBalances[$scope.index.assetIndex];
			//console.log($scope.index.arrBalances.length+" assets, current: "+$scope.asset);

			Object.defineProperty($scope,
				"_customAmount", {
				get: function() {
					return $scope.customAmount;
				},
				set: function(newValue) {
					$scope.customAmount = newValue;
				},
				enumerable: true,
				configurable: true
			});

			$scope.submitForm = function(form) {
				if ($scope.index.arrBalances.length === 0)
					return console.log('showRequestPaymentModal: no balances yet');
				var amount = form.amount.$modelValue;
				//var asset = form.asset.$modelValue;
				var asset = $scope.index.arrBalances[$scope.index.assetIndex].asset;
				if (!asset)
					throw Error("no asset");
				var amountInSmallestUnits = (asset === 'base') ? parseInt((amount * $scope.unitValue).toFixed(0)) : (asset === constants.BLACKBYTES_ASSET ? parseInt((amount * $scope.bbUnitValue).toFixed(0)) : amount);
				var params = 'amount='+amountInSmallestUnits;
				if (asset !== 'base')
					params += '&asset='+encodeURIComponent(asset);
				var units = (asset === 'base') ? $scope.unitName : (asset === constants.BLACKBYTES_ASSET ? $scope.bbUnitName : ('of '+asset));
				appendText('['+amount+' '+units+'](byteball:'+myPaymentAddress+'?'+params+')');
				$modalInstance.dismiss('cancel');
			};

			$scope.cancel = function() {
				$modalInstance.dismiss('cancel');
			};
		};

		var modalInstance = $modal.open({
			templateUrl: 'views/modals/customized-amount.html',
			windowClass: animationService.modalAnimated.slideUp,
			controller: ModalInstanceCtrl,
			scope: $scope
		});

		var disableCloseModal = $rootScope.$on('closeModal', function() {
			modalInstance.dismiss('cancel');
		});

		modalInstance.result.finally(function() {
			$rootScope.modalOpened = false;
			disableCloseModal();
			var m = angular.element(document.getElementsByClassName('reveal-modal'));
			m.addClass(animationService.modalAnimated.slideOutDown);
		});
	}

	function setOngoingProcess(name) {
		if (isCordova) {
			if (name) {
				window.plugins.spinnerDialog.hide();
				window.plugins.spinnerDialog.show(null, name + '...', true);
			} else {
				window.plugins.spinnerDialog.hide();
			}
		} else {
			$scope.onGoingProcess = name;
			$timeout(function() {
				$rootScope.$apply();
			});
		}
	};

	$scope.goToCorrespondentDevices = function() {
		$deepStateRedirect.reset('correspondentDevices');
		go.path('correspondentDevices');
	}
	
}).directive('sendPayment', function($compile){
	console.log("sendPayment directive");
	return {
		replace: true,
		//scope: {address: '@'},
		//template: '<a ng-click="sendPayment(address)">{{address}}</a>',
		//template: '<a ng-click="console.log(789)">{{address}} 88</a>',
		link: function($scope, element, attrs){
			console.log("link called", attrs, element);
			//element.attr('ng-click', "console.log(777)");
			//element.removeAttr('send-payment');
			//$compile(element)($scope);
			//$compile(element.contents())($scope);
			//element.replaceWith($compile('<a ng-click="sendPayment(\''+attrs.address+'\')">'+attrs.address+'</a>')(scope));
			//element.append($compile('<a ng-click="console.log(123456)">'+attrs.address+' 99</a>')($scope));
			element.bind('click', function(){
				console.log('clicked', attrs);
				$scope.sendPayment(attrs.address);
			});
		}
	};
}).directive('dynamic', function ($compile) {
	return {
		restrict: 'A',
		replace: true,
		link: function (scope, ele, attrs) {
			scope.$watch(attrs.dynamic, function(html) {
				ele.html(html);
				$compile(ele.contents())(scope);
			});
		}
	};
}).directive('scrollBottom', function ($timeout) { // based on http://plnkr.co/edit/H6tFjw1590jHT28Uihcx?p=preview
	return {
		link: function (scope, element) {
			scope.$watchCollection('messageEvents', function (newValue) {
				if (newValue)
					$timeout(function(){
						element[0].scrollTop = element[0].scrollHeight;
					}, 100);
			});
		}
	}
}).directive('bindToHeight', function ($window) {
	return {
		restrict: 'A',
		link: function (scope, elem, attrs) {
			var attributes = scope.$eval(attrs['bindToHeight']);
			var targetElem = angular.element(document.querySelector(attributes[1]));

			// Watch for changes
			scope.$watch(function () {
				return targetElem[0].clientHeight;
			},
			function (newValue, oldValue) {
				if (newValue != oldValue && newValue != 0) {
					elem.css(attributes[0], newValue + 'px');
					//elem[0].scrollTop = elem[0].scrollHeight;
				}
			});
		}
	};
}).directive('ngEnter', function() {
    return function(scope, element, attrs) {
        element.bind("keydown", function(e) {
            if(e.which === 13 && !e.shiftKey) {
                scope.$apply(function(){
                    scope.$eval(attrs.ngEnter, {'e': e});
                });
                e.preventDefault();
            }
        });
    };
});;
