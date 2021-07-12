'use strict';

var constants = require('ocore/constants.js');
var eventBus = require('ocore/event_bus.js');
var breadcrumbs = require('ocore/breadcrumbs.js');
var ValidationUtils = require('ocore/validation_utils.js');
var parse_ojson = require('ocore/formula/parse_ojson');

angular.module('copayApp.controllers')
	.controller('walletHomeController', function($scope, $rootScope, $timeout, $filter, $modal, $log, notification, isCordova, profileService, lodash, configService, storageService, gettext, gettextCatalog, nodeWebkit, addressService, confirmDialog, animationService, addressbookService, correspondentListService, correspondentService, newVersion, autoUpdatingWitnessesList, go, aliasValidationService, fileSystemService, aaDocService) {

		var self = this;
		var home = this;
		$scope.Math = window.Math;
		var conf = require('ocore/conf.js');
		var chatStorage = require('ocore/chat_storage.js');
		this.bb_protocol = conf.program;
		this.protocol = conf.program.replace(/byteball/i, 'obyte');
		$rootScope.hideMenuBar = false;
		$rootScope.wpInputFocused = false;
		$rootScope.showableWalletAvatar = false;
		var config = configService.getSync();
		var configWallet = config.wallet;
		var indexScope = $scope.index;
		var network = require('ocore/network.js');

		// INIT
		var walletSettings = configWallet.settings;
		this.unitValue = walletSettings.unitValue;
		this.bbUnitValue = walletSettings.bbUnitValue;
		this.unitName = walletSettings.unitName;
		this.bbUnitName = walletSettings.bbUnitName;
		this.unitDecimals = walletSettings.unitDecimals;
		this.isCordova = isCordova;
		this.addresses = [];
		this.isMobile = isMobile.any();
		this.isWindowsPhoneApp = isMobile.Windows() && isCordova;
		this.blockUx = false;
		this.showScanner = false;
		this.addr = {};
		this.assetDropDownVisible = false;
		this.isTestnet = constants.version.match(/t$/);
		this.testnetName = (constants.alt === '2') ? '[NEW TESTNET]' : '[TESTNET]';
		this.exchangeRates = network.exchangeRates;
		this.dataAssets = [
			{
				index: -1,
				asset: 'Data into datafeed (searchable)'
			},
			{
				index: -2,
				asset: 'Attestation of any address'
			},
			{
				index: -3,
				asset: 'Profile of my address'
			},
			{
				index: -4,
				asset: 'Raw data'
			},
			{
				index: -5,
				asset: 'Poll'
			},
			{
				index: -6,
				asset: 'Definition of autonomous agent'
			},
			{
				index: -7,
				asset: 'Text'
			},
		]
		$scope.index.tab = 'walletHome'; // for some reason, current tab state is tracked in index and survives re-instatiations of walletHome.js
		self.android = isMobile.Android() && window.cordova;
		self.androidVersion = isMobile.Android() ? parseFloat(navigator.userAgent.slice(navigator.userAgent.indexOf("Android")+8)) : null;
		self.oldAndroidFilePath = null;
		self.oldAndroidFileName = '';

		self.oldAndroidInputFileClick = function() {
			if(isMobile.Android() && self.androidVersion < 5) {
				window.plugins.mfilechooser.open([], function(uri) {
					self.oldAndroidFilePath = 'file://' + uri;
					self.oldAndroidFileName = uri.split('/').pop();
					$timeout(function() {
						$rootScope.$apply();
					});
					if (!self.oldAndroidFilePath)
						return;
					self.importing = true;
					fileSystemService.readFile(self.oldAndroidFilePath, function(err, data) {
						if (err) {
							self.setSendError("cannot read the file whose hash is going to be posted");
							return;
						}
						const hash = require("crypto")
							.createHash("sha256")
							.update(data)
							.digest("hex");
						home.feedvaluespairs.push({
							name: home.attachedFile.name,
							value: hash,
						});
						$scope.$apply();
					})
				}, function(error) {
					alert(error);
				});
			}
		};

		var disablePaymentRequestListener = $rootScope.$on('paymentRequest', function(event, address, amount, asset, recipient_device_address, base64data, from_address, single_address) {
			console.log('paymentRequest event ' + address + ', ' + amount);
			self.resetForm();
			$timeout(function() {
				$rootScope.$emit('Local/SetTab', 'send');
				self.setForm(address, amount, null, asset, recipient_device_address, base64data, from_address, single_address);
			}, 100);

			/*var form = $scope.sendPaymentForm;
			if (form.address && form.address.$invalid && !self.blockUx) {
				console.log("invalid address, resetting form");
				self.resetForm();
				self.error = gettext('Could not recognize a valid Obyte QR Code');
			}*/
		});

		var disableDataPromptListener = $rootScope.$on('dataPrompt', function(event, dataPrompt) {
			console.log('dataPrompt event ', dataPrompt);
			$rootScope.$emit('Local/SetTab', 'send');
			self.setDataForm(dataPrompt);
		});

		var disablePaymentUriListener = $rootScope.$on('paymentUri', function(event, uri) {
			console.log('paymentUri event ' + uri);
			self.resetForm();
			$timeout(function() {
				$rootScope.$emit('Local/SetTab', 'send');
				self.setForm(uri);
			}, 100);
		});

		var disableAddrListener = $rootScope.$on('Local/NeedNewAddress', function() {
			self.setAddress(true);
		});

		var disableFocusListener = $rootScope.$on('Local/NewFocusedWallet', function() {
			self.addr = {};
			self.resetForm();
			self.setAddress();
		});

		var disableResumeListener = $rootScope.$on('Local/Resume', function() {
			// This is needed then the apps go to sleep
			// looks like it already works ok without rebinding touch events after every resume
			//self.bindTouchDown();
		});

		var disableAssetDropDownListener = $rootScope.$on('closeAssetDropDown', function () {
			if (self.assetDropDownVisible) {
				self.toggleAssetDropwDown();
				$timeout(function() {
					$scope.$digest();
				});
			}
		});

		var disableTabListener = $rootScope.$on('Local/TabChanged', function(e, tab) {
			// This will slow down switch, do not add things here!
			console.log("tab changed " + tab);
			switch (tab) {
				case 'receive':
					// just to be sure we have an address
					self.setAddress();
					break;
				case 'history':
					$rootScope.$emit('Local/NeedFreshHistory');
					$timeout(() => {
						self.countChecker();
					}, 100);
					break;
				case 'send':
					self.resetError();
			}
		});

		this.countChecker = function() {
			self.newPaymentsCount = $rootScope.newPaymentsCount;
		};

		var disableOngoingProcessListener = $rootScope.$on('Addon/OngoingProcess', function(e, name) {
			self.setOngoingProcess(name);
		});

		function onNewWalletAddress(new_address) {
			console.log("==== NEW ADDRESSS " + new_address);
			self.addr = {};
			self.setAddress();
		}

		eventBus.on("new_wallet_address", onNewWalletAddress);

		$scope.$on('$destroy', function() {
			console.log("walletHome $destroy");
			disableAddrListener();
			disablePaymentRequestListener();
			disableDataPromptListener();
			disablePaymentUriListener();
			disableTabListener();
			disableFocusListener();
			disableResumeListener();
			disableOngoingProcessListener();
			disableClaimTextcoinListener();
			disableAssetDropDownListener();
			$rootScope.hideMenuBar = false;
			eventBus.removeListener("new_wallet_address", onNewWalletAddress);
		});

		//$rootScope.$digest();

		var accept_msg = gettextCatalog.getString('Accept');
		var cancel_msg = gettextCatalog.getString('Cancel');
		var confirm_msg = gettextCatalog.getString('Confirm');

		$scope.openDestinationAddressModal = function(wallets, address) {
			$rootScope.modalOpened = true;
			var fc = profileService.focusedClient;
			//self.resetForm();

			var ModalInstanceCtrl = function($scope, $modalInstance) {
				$scope.wallets = wallets;
				$scope.editAddressbook = false;
				$scope.addAddressbookEntry = false;
				$scope.selectedAddressbook = {};
				$scope.newAddress = address;
				$scope.addressbook = {
					'address': ($scope.newAddress || ''),
					'label': ''
				};
				$scope.color = fc.backgroundColor;
				$scope.bAllowAddressbook = self.canSendExternalPayment();

				$scope.beforeQrCodeScann = function() {
					$scope.error = null;
					$scope.addAddressbookEntry = true;
					$scope.editAddressbook = false;
				};

				$scope.onQrCodeScanned = function(data, addressbookForm) {
					$timeout(function() {
						var form = addressbookForm;
						if (data && form) {
							data = data.replace(self.protocol + ':', '');
							data = data.replace(self.bb_protocol + ':', '');
							form.address.$setViewValue(data);
							form.address.$isValid = true;
							form.address.$render();
						}

						$scope.$digest();
					}, 100);
				};

				$scope.selectAddressbook = function(addr) {
					$modalInstance.close(addr);
				};

				$scope.toggleEditAddressbook = function() {
					$scope.editAddressbook = !$scope.editAddressbook;
					$scope.selectedAddressbook = {};
					$scope.addAddressbookEntry = false;
				};

				$scope.toggleSelectAddressbook = function(addr) {
					$scope.selectedAddressbook[addr] = $scope.selectedAddressbook[addr] ? false : true;
				};

				$scope.toggleAddAddressbookEntry = function() {
					$scope.error = null;
					$scope.addressbook = {
						'address': ($scope.newAddress || ''),
						'label': ''
					};
					$scope.addAddressbookEntry = !$scope.addAddressbookEntry;
				};

				$scope.listEntries = function() {
					$scope.error = null;
					addressbookService.list(function(err, ab) {
						if (err) {
							$scope.error = err;
							return;
						}
						$scope.list = ab;
						$timeout(function() {
							$scope.$digest();
						});
					});
				};

				$scope.add = function(addressbook) {
					$scope.error = null;
					$timeout(function() {
						addressbookService.add(addressbook, function(err, ab) {
							if (err) {
								$scope.error = err;
								return;
							}
							$rootScope.$emit('Local/AddressbookUpdated', ab);
							$scope.list = ab;
							$scope.editAddressbook = true;
							$scope.toggleEditAddressbook();
							$scope.$digest();
						});
					}, 100);
				};

				$scope.remove = function(addr) {
					$scope.error = null;
					$timeout(function() {
						addressbookService.remove(addr, function(err, ab) {
							if (err) {
								$scope.error = err;
								return;
							}
							$rootScope.$emit('Local/AddressbookUpdated', ab);
							$scope.list = ab;
							$scope.$digest();
						});
					}, 100);
				};

				$scope.cancel = function() {
					breadcrumbs.add('openDestinationAddressModal cancel');
					$modalInstance.dismiss('cancel');
				};

				$scope.selectWallet = function(walletId, walletName) {
					//$scope.gettingAddress = true; // this caused a weird hang under cordova if used after pulling "..." drop-up menu in chat
					$scope.selectedWalletName = walletName;
					//$timeout(function() { // seems useless
					//  $scope.$apply();
					//});
					addressService.getAddress(walletId, false, function onGotAddress(err, addr) {
						$scope.gettingAddress = false;

						if (err) {
							self.error = err;
							breadcrumbs.add('openDestinationAddressModal getAddress err: ' + err);
							$modalInstance.dismiss('cancel');
							return;
						}

						$modalInstance.close(addr);
					});
				};
			};

			var modalInstance = $modal.open({
				templateUrl: 'views/modals/destination-address.html',
				windowClass: animationService.modalAnimated.slideUp,
				controller: ModalInstanceCtrl,
			});

			var disableCloseModal = $rootScope.$on('closeModal', function() {
				breadcrumbs.add('openDestinationAddressModal on closeModal');
				modalInstance.dismiss('cancel');
			});

			modalInstance.result.finally(function() {
				$rootScope.modalOpened = false;
				disableCloseModal();
				var m = angular.element(document.getElementsByClassName('reveal-modal'));
				m.addClass(animationService.modalAnimated.slideOutDown);
			});

			modalInstance.result.then(function onDestModalDone(addr) {
				if (addr) {
					self.setToAddress(addr);
				}
			});
		};

		$scope.openSharedAddressDefinitionModal = function(address) {
			$rootScope.modalOpened = true;
			var fc = profileService.focusedClient;

			var ModalInstanceCtrl = function($scope, $modalInstance) {
				$scope.color = fc.backgroundColor;
				$scope.address = address;
				$scope.shared_address_cosigners = indexScope.shared_address_cosigners;

				var walletGeneral = require('ocore/wallet_general.js');
				var walletDefinedByAddresses = require('ocore/wallet_defined_by_addresses.js');
				walletGeneral.readMyPersonalAndSharedAddresses(function(arrMyAddresses) {
					walletDefinedByAddresses.readSharedAddressDefinition(address, function(arrDefinition, creation_ts) {
						walletDefinedByAddresses.readSharedAddressPeers(address, function(assocPeerNamesByAddress) {
							$scope.humanReadableDefinition = correspondentListService.getHumanReadableDefinition(arrDefinition, arrMyAddresses, [], assocPeerNamesByAddress, true);
							$scope.creation_ts = creation_ts;
							$timeout(function() {
								$scope.$apply();
							});
						});
					});
				});

				// clicked a link in the definition
				$scope.sendPayment = function(address, amount, asset) {
					if (asset && indexScope.arrBalances.filter(function(balance) {
							return (balance.asset === asset);
						})
						.length === 0)
						return console.log("i do not own anything of asset " + asset);
					$modalInstance.dismiss('done');
					$timeout(function() {
						indexScope.shared_address = null;
						indexScope.updateAll();
						indexScope.updateTxHistory();
						$rootScope.$emit('paymentRequest', address, amount, asset);
					});
				};

				$scope.cancel = function() {
					breadcrumbs.add('openSharedAddressDefinitionModal cancel');
					$modalInstance.dismiss('cancel');
				};

			};

			var modalInstance = $modal.open({
				templateUrl: 'views/modals/address-definition.html',
				windowClass: animationService.modalAnimated.slideUp,
				controller: ModalInstanceCtrl,
			});

			var disableCloseModal = $rootScope.$on('closeModal', function() {
				breadcrumbs.add('openSharedAddressDefinitionModal on closeModal');
				modalInstance.dismiss('cancel');
			});

			modalInstance.result.finally(function() {
				$rootScope.modalOpened = false;
				disableCloseModal();
				var m = angular.element(document.getElementsByClassName('reveal-modal'));
				m.addClass(animationService.modalAnimated.slideOutDown);
			});

		};
		
		var clickHandler = function(e){
			let inside = e.target.closest('.custom-dropdown');
			if (!inside) {
				$rootScope.$emit("closeAssetDropDown");
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};
		this.toggleAssetDropwDown = function(state, target) {
			self.assetDropDownVisible = (typeof state === "undefined" || state === null) ? !self.assetDropDownVisible : state;
			document.removeEventListener('click', clickHandler, true);
			if (self.assetDropDownVisible) {
				$scope.assetSubstring = "";
				document.addEventListener('click', clickHandler, true);

				if (isCordova)
					return;
				$timeout(function() {
					var elems = (target ? target.parentNode.parentNode : document).querySelectorAll('.search-bar input');
					if (elems.length)
						elems[0].focus();
				});
			}
		}

		this.changeAssetIndexSelectorValue = function(assetIndexSelectorValue) {
			$scope.assetIndexSelectorValue = assetIndexSelectorValue;
			self.toggleAssetDropwDown();
			self.forceAmountRevalidation();
			self.switchForms();
			self.onChanged();
		}

		this.openTxpModal = function(tx, copayers) {
			// deleted, maybe restore from copay sometime later
			// actually, nothing to display here that was not already shown
		};

		this.setAddress = function(forceNew) {
			self.addrError = null;
			var fc = profileService.focusedClient;
			if (!fc)
				return;

			// Address already set?
			if (!forceNew && self.addr[fc.credentials.walletId])
				return;

			if (!fc.credentials.isComplete())
				return console.log('wallet not complete yet');

			if (indexScope.shared_address && forceNew)
				throw Error('attempt to generate for shared address');

			if (fc.isSingleAddress && forceNew)
				throw Error('attempt to generate for single address wallets');

			self.generatingAddress = true;
			$timeout(function() {
				addressService.getAddress(fc.credentials.walletId, forceNew, function(err, addr) {
					self.generatingAddress = false;

					if (err) {
						self.addrError = err;
					}
					else {
						if (addr)
							self.addr[fc.credentials.walletId] = addr;
					}

					$timeout(function() {
						$scope.$digest();
					});
				});
			});
		};

		this.copyAddress = function(addr) {
			if (isCordova) {
				window.cordova.plugins.clipboard.copy(addr);
				window.plugins.toast.showShortCenter(gettextCatalog.getString('Copied to clipboard'));
			}
			else if (nodeWebkit.isDefined()) {
				nodeWebkit.writeToClipboard(addr);
			}
		};

		this.shareAddress = function(addr) {
			if (isCordova) {
				if (isMobile.Android() || isMobile.Windows()) {
					window.ignoreMobilePause = true;
				}
				window.plugins.socialsharing.shareWithOptions({message: "My Obyte address " + self.protocol +  ':' + addr, subject: "My Obyte address"/*, url: self.protocol +  ':' + addr*/}, function(){}, function(){});
			}
		};

		this.openCustomizedAmountModal = function(addr) {
			$rootScope.modalOpened = true;
			var self = this;
			var fc = profileService.focusedClient;
			var ModalInstanceCtrl = function($scope, $modalInstance) {
				$scope.addr = addr;
				$scope.color = fc.backgroundColor;
				$scope.unitName = self.unitName;
				$scope.unitValue = self.unitValue;
				$scope.unitDecimals = self.unitDecimals;
				$scope.bbUnitValue = walletSettings.bbUnitValue;
				$scope.bbUnitName = walletSettings.bbUnitName;
				$scope.isCordova = isCordova;
				$scope.buttonLabel = gettextCatalog.getString('Generate QR Code');
				$scope.protocol = conf.program.replace(/byteball/i, 'obyte');

				Object.defineProperty($scope, "_customAmount", {
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
						return console.log('openCustomizedAmountModal: no balances yet');
					var amount = form.amount.$modelValue;
					var assetInfo = $scope.index.arrBalances[$scope.index.assetIndex];
					var asset = assetInfo.asset;
					if (!asset)
						throw Error("no asset");
					var amountInSmallestUnits = profileService.getAmountInSmallestUnits(amount, asset);
					var asset_param = (asset === 'base') ? '' : '&asset=' + encodeURIComponent(asset);
					$timeout(function() {
						$scope.customizedAmountUnit =
							amount + ' ' + ((asset === 'base') ? $scope.unitName : (asset === constants.BLACKBYTES_ASSET ? $scope.bbUnitName : (assetInfo.name || 'of ' + asset)));
						$scope.amountInSmallestUnits = amountInSmallestUnits;
						$scope.qr_string = $scope.protocol + ":" + $scope.addr + '?amount=' + amountInSmallestUnits + asset_param;
						$scope.qr_version = indexScope.determineQRcodeVersionFromString( $scope.qr_string );
					}, 1);
				};

				$scope.shareAddress = function(uri) {
					if (isCordova) {
						if (isMobile.Android() || isMobile.Windows())
							window.ignoreMobilePause = true;
						window.plugins.socialsharing.share(uri, null, null, null);
					}
				};

				$scope.cancel = function() {
					breadcrumbs.add('openCustomizedAmountModal: cancel');
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
				breadcrumbs.add('openCustomizedAmountModal: on closeModal');
				modalInstance.dismiss('cancel');
			});

			modalInstance.result.finally(function() {
				$rootScope.modalOpened = false;
				disableCloseModal();
				var m = angular.element(document.getElementsByClassName('reveal-modal'));
				m.addClass(animationService.modalAnimated.slideOutDown);
			});
		};

		this.openClaimTextcoinModal = function(addr) {
			$rootScope.modalOpened = true;
			var fc = profileService.focusedClient;
			var ModalInstanceCtrl = function($scope, $modalInstance) {
				$scope.color = fc.backgroundColor;
				$scope.buttonLabel = gettextCatalog.getString('Claim funds');

				$scope.submitForm = function(form) {
					$modalInstance.close(form.mnemonic.$modelValue);
				};

				$scope.cancel = function() {
					breadcrumbs.add('openCustomizedAmountModal: cancel');
					$modalInstance.dismiss('cancel');
				};
			};

			var modalInstance = $modal.open({
				templateUrl: 'views/modals/claim-textcoin.html',
				windowClass: animationService.modalAnimated.slideUp,
				controller: ModalInstanceCtrl,
				scope: $scope
			});

			var disableCloseModal = $rootScope.$on('closeModal', function() {
				breadcrumbs.add('openClaimTextcoinModal: on closeModal');
				modalInstance.dismiss('cancel');
			});

			modalInstance.result.finally(function(val) {
				$rootScope.modalOpened = false;
				disableCloseModal();
				var m = angular.element(document.getElementsByClassName('reveal-modal'));
				m.addClass(animationService.modalAnimated.slideOutDown);
			});

			modalInstance.result.then(function(mnemonic) {
				if (mnemonic) {
					claimTextCoin(mnemonic, addr);
				}
			});
		};

		function claimTextCoin(mnemonic, addr) {
			var wallet = require('ocore/wallet.js');
			$rootScope.$emit('process_status_change', 'claiming', true);
			wallet.receiveTextCoin(mnemonic, addr, function(err, unit, asset) {
				$timeout(function() {
					$rootScope.$emit('closeModal');
					if (err) {
						if (err.indexOf("not confirmed") !== -1) {
							store_mnemonic_back();
						}
						$rootScope.$emit('process_status_change', 'claiming', false);
						return $rootScope.$emit('Local/ShowErrorAlert', err);
					}
					if (asset) {
						var disableBalanceListener = $rootScope.$on('Local/BalanceUpdated', function(assocBalances) {
							var assetIndex = lodash.findIndex(indexScope.arrBalances, {
								asset: asset
							});
							indexScope.assetIndex = assetIndex;
							indexScope.updateTxHistory();
							$rootScope.$emit('Local/SetTab', 'history', null, true);
							disableBalanceListener();
						});
						indexScope.updateAll();
					} else {
						indexScope.assetIndex = 0;
						indexScope.updateAll({triggerTxUpdate: true});
						$rootScope.$emit('Local/SetTab', 'history', null, true);
					}
					$scope.$digest();
					$rootScope.$emit('process_status_change', 'claiming', false);
				});
			});
		}

		var disableClaimTextcoinListener = $rootScope.$on('claimTextcoin', function(event, mnemonic) {
			breadcrumbs.add("received claimTextcoin event with mnemonic: " + mnemonic.substr(0, 10) + "...");
			var addr = self.addr[profileService.focusedClient.credentials.walletId];
			if (addr) {
				claimTextCoin(mnemonic, addr);
			} else {
				addressService.getAddress(profileService.focusedClient.credentials.walletId, false, function(err, addr) {
					if (addr) {
						self.addr[profileService.focusedClient.credentials.walletId] = addr;
						claimTextCoin(mnemonic, addr);
					}

					$timeout(function() {
						$scope.$digest();
					});
				});
			}
		});

		// Send

		$scope.$on('$destroy', function() {
		//	unwatchSpendUnconfirmed();
		});

		this.resetError = function() {
			this.error = this.success = null;
		};

		this.bindTouchDown = function(tries) {
			var self = this;
			tries = tries || 0;
			if (tries > 5) return;
			var e = document.getElementById('menu-walletHome');
			if (!e) return $timeout(function() {
				self.bindTouchDown(++tries);
			}, 500);

			// on touchdown elements
			$log.debug('Binding touchstart elements...');
			['hamburger', 'menu-walletHome', 'menu-send', 'menu-receive', 'menu-history'].forEach(function(id) {
				var e = document.getElementById(id);
				if (e) e.addEventListener('touchstart', function() {
					try {
						event.preventDefault();
					}
					catch (e) {};
					$timeout(function(){
						try {
							angular.element(e).triggerHandler('click');
						} catch (e) {};
					});
				}, true);
			});
		}

		this.hideMenuBar = lodash.debounce(function(hide) {
			if (hide) {
				$rootScope.hideMenuBar = true;
				this.bindTouchDown();
			}
			else {
				$rootScope.hideMenuBar = false;
			}
			$timeout(function(){
				$rootScope.$digest();
			});
		}, 100);

		this.formFocus = function(what) {
			if (isCordova && !this.isWindowsPhoneApp) {
				this.hideMenuBar(what);
			}
			if (!this.isWindowsPhoneApp) return

			if (!what) {
				this.hideAddress = false;
				this.hideAmount = false;

			}
			else {
				if (what == 'amount') {
					this.hideAddress = true;
				}
				else if (what == 'msg') {
					this.hideAddress = true;
					this.hideAmount = true;
				}
			}
			$timeout(function() {
				$rootScope.$digest();
			}, 1);
		};

		this.setSendPaymentFormInputs = function() {
			/**
			 * Setting the two related amounts as properties prevents an infinite
			 * recursion for watches while preserving the original angular updates
			 *
			 */
			Object.defineProperty($scope,
				"_amount", {
					get: function() {
						return $scope.__amount;
					},
					set: function(newValue) {
						$scope.__amount = newValue;
						self.resetError();
					},
					enumerable: true,
					configurable: true
				});

			Object.defineProperty($scope,
				"_address", {
					get: function() {
						return $scope.__address;
					},
					set: function(newValue) {
						$scope.__address = self.onAddressChange(newValue);
					},
					enumerable: true,
					configurable: true
				});

			var fc = profileService.focusedClient;
			// ToDo: use a credential's (or fc's) function for this
			this.hideNote = true;
		};

		this.setSendError = function(err) {
			var fc = profileService.focusedClient;
			var prefix =
				fc.credentials.m > 1 ? gettextCatalog.getString('Could not create payment proposal') : gettextCatalog.getString('Could not send payment');

			this.error = prefix + ": " + err;
			console.log(this.error);

			$timeout(function() {
				$scope.$digest();
			}, 1);
		};

		this.setOngoingProcess = function(name) {
			var self = this;
			self.blockUx = !!name;

			if (isCordova) {
				if (name) {
					window.plugins.spinnerDialog.hide();
					window.plugins.spinnerDialog.show(null, name + '...', true);
				}
				else {
					window.plugins.spinnerDialog.hide();
				}
			}
			else {
				self.onGoingProcess = name;
				$timeout(function() {
					$rootScope.$apply();
				});
			};
		};

		function getShareMessage(amount, mnemonic, asset) {
			var usd_amount_str = "";
			var is_private = (asset == constants.BLACKBYTES_ASSET);
			if (!asset || asset == "base" || asset == constants.BLACKBYTES_ASSET) {
				var pair = asset == constants.BLACKBYTES_ASSET ? "GBB_USD" : "GBYTE_USD";
				if (network.exchangeRates[pair]) {
					usd_amount_str = " (≈" + ((amount/1e9)*network.exchangeRates[pair]).toLocaleString([], {maximumFractionDigits: 2}) + " USD)";
				}
				if (amount >= Math.pow(10, 9)) {
					amount = (amount/1e9).toLocaleString([], {maximumFractionDigits: 9});
					asset = asset == constants.BLACKBYTES_ASSET ? "GBB" : "GB";
				}
				else if (amount >= Math.pow(10, 6)) {
					amount = (amount/1e6).toLocaleString([], {maximumFractionDigits: 6});
					asset = asset == constants.BLACKBYTES_ASSET ? "MBB" : "MB";
				}
				else if (amount >= Math.pow(10, 3)) {
					amount = (amount/1e3).toLocaleString([], {maximumFractionDigits: 3});
					asset = asset == constants.BLACKBYTES_ASSET ? "KBB" : "KB";
				}
				else {
					amount = amount.toLocaleString([], {maximumFractionDigits: 0});
					asset = asset == constants.BLACKBYTES_ASSET ? "Blackbytes" : "Bytes";
				}
			} else {
				//indexScope.arrBalances[$scope.index.assetIndex]
				var assetInfo = lodash.find(indexScope.arrBalances, function(balance){return balance.asset == asset});
				if (assetInfo) {
					is_private = assetInfo.is_private;
					var pair = asset + "_USD";
					if (network.exchangeRates[pair]) {
						usd_amount_str = " (≈" + (amount / Math.pow(10, assetInfo.decimals || 0) * network.exchangeRates[pair]).toLocaleString([], {maximumFractionDigits: 2}) + " USD)";
					}
					if (assetInfo.decimals) {
						amount /= Math.pow(10, assetInfo.decimals);
					}
					asset = assetInfo.name ? assetInfo.name : asset;
				}
			}
			return {
				message: "Here is your " + (is_private ? "file" : "link") + " to receive " + amount + " " + asset + usd_amount_str + (is_private ? ".  If you don't have a Obyte wallet yet, install it from https://obyte.org." : (": https://obyte.org/#textcoin?" + mnemonic)),
				subject: "Obyte user beamed you money"
			}
		}

		this.openShareTextcoinModal = function(addr, mnemonic, amount, asset, isResend, filePath) {
			if (!addr && isCordova) {
				if (isMobile.Android() || isMobile.Windows()) {
					window.ignoreMobilePause = true;
				}
				var removeFile = function() {};
				window.plugins.socialsharing.shareWithOptions(lodash.assign(getShareMessage(amount, mnemonic, asset), {files: filePath ? [filePath] : []}), removeFile, removeFile);
				return;
			}
			if (filePath)
				return;
			var msg = getShareMessage(amount, mnemonic, asset);
			var text = msg.message;
			var subject = msg.subject;
			$rootScope.modalOpened = true;
			var fc = profileService.focusedClient;
			var ModalInstanceCtrl = function($scope, $modalInstance) {
				$scope.color = fc.backgroundColor;
				$scope.buttonLabel = gettextCatalog.getString((isResend ? 're' : '' ) + 'send email');
				$scope.isCordova = isCordova;
				$scope.address = addr;
				$scope.mnemonic = mnemonic;
				$scope.text = text;
				$scope.subject = subject;
				$scope.isResend = isResend;
				$scope.filePath = filePath;

				$scope.shareToEmail = function() {
					window.plugins.socialsharing.shareViaEmail(text, subject, [addr]);
					$modalInstance.close();
				};

				$scope.cancel = function() {
					breadcrumbs.add('openShareTextcoinModal: cancel');
					$modalInstance.dismiss('cancel');
				};
			};

			var modalInstance = $modal.open({
				templateUrl: 'views/modals/share.html',
				windowClass: animationService.modalAnimated.slideUp,
				controller: ModalInstanceCtrl,
				scope: $scope
			});

			var disableCloseModal = $rootScope.$on('closeModal', function() {
				breadcrumbs.add('openShareTextcoinModal: on closeModal');
				modalInstance.dismiss('cancel');
			});

			modalInstance.result.finally(function(val) {
				$rootScope.modalOpened = false;
				disableCloseModal();
				var m = angular.element(document.getElementsByClassName('reveal-modal'));
				m.addClass(animationService.modalAnimated.slideOutDown);
			});
		};

		this.validateAADefinition = function () {
			var form = $scope.sendDataForm;
			form.definition.$setValidity('aaDef', false);
			lodash.debounce(function () {
				parse_ojson.parse(self.definition, function(err, arrDefinition) {
					if (err) {
						self.aa_validation_error = err.toString();
						$timeout(function() {
							$scope.$digest();
						});
						return;
					}

					var aa_validation = require('ocore/aa_validation.js');
					aa_validation.validateAADefinition(arrDefinition, function (err) {
						self.aa_validation_error = err;
						if (form.definition)
							form.definition.$setValidity('aaDef', !err);
						$timeout(function() {
							$scope.$digest();
						});
					});
				});
			}, 500)();
		}

		this.validateTextLength = function () {
			var form = $scope.sendDataForm;
			form.content.$setValidity('validLength', !(self.content && self.content.length > 140));
		}

		this.onAddressChanged = function () {
			resetAAFields();
			var form = $scope.sendPaymentForm;
			if (form.address.$invalid) {
				self.aa_destinations = [];
				return console.log('address still invalid');
			}
			var address = form.address.$modelValue;
			if (ValidationUtils.isValidAddress(address))
				return checkIfAAAndUpdateResults(address);
			var accountValidationResult = aliasValidationService.validate(address);
			if (!accountValidationResult.isValid)
				return;
			var attestorKey = accountValidationResult.attestorKey;
			var account = accountValidationResult.account;
			var bb_address = aliasValidationService.getBbAddress(attestorKey, account);
			if (!bb_address) {
				return aliasValidationService.resolveValueToBbAddress(attestorKey, account, function () {
					// assocBbAddresses in aliasValidationService is now filled
					self.onAddressChanged();
				});
			}
			if (bb_address === 'unknown' || bb_address === 'none' || !ValidationUtils.isValidAddress(bb_address))
				return;
			checkIfAAAndUpdateResults(bb_address);
		};

		function resetAAFields() {
			self.aa_destinations = [];
			self.added_bounce_fees = [];
			self.aa_data_fields_defined = [];

			self.aa_description = '';
			self.aa_truncated_description = '';
			self.bShowFullDescription = false;
			self.aa_homepage_url = '';
			self.aa_source_url = '';
			self.aa_field_descriptions = {};

			self.custom_amount_error = null;
			self.aa_dry_run_error = null;
			self.aa_message_results = [];
			self.aa_state_changes = [];
			self.responseVars = [];
		}

		function checkIfAAAndUpdateResults(address) {
			self.bEstimatingAAResults = true;
			readAADefinitionsWithBaseDefinitions(address, function (rows) {
				self.aa_destinations = rows;
				if (rows.length > 0) {
					updateAADocs();
					return updateAAResults();
				}
				else
					self.bEstimatingAAResults = false;
				$timeout(function() {
					$scope.$digest();
				});
			});
		}

		function readAADefinitionsWithBaseDefinitions(address, handleResult) {
			var aa_addresses = require('ocore/aa_addresses.js');
			aa_addresses.readAADefinitions([address], function (rows) {
				if (rows.length === 0)
					return handleResult([]);
				if (!rows[0].base_aa) // regular AA
					return handleResult(rows);
				// else, parameterized AA
				aa_addresses.readAADefinitions([rows[0].base_aa], function (base_rows) {
					if (base_rows.length === 0) // should never happen
						return handleResult(rows);
					rows[0].base_definition = base_rows[0].definition;
					handleResult(rows);
				});
			});
		}

		function updateAADocs() {
			var row = self.aa_destinations[0];
			aaDocService.getAADocs(row.address, row.base_definition || row.definition, doc => {
				if (!doc)
					return;
				self.aa_description = doc.description;
				self.aa_homepage_url = doc.homepage_url;
				self.aa_source_url = doc.source_url;
				self.aa_field_descriptions = doc.field_descriptions;
				if (self.aa_description.length > 200)
					self.aa_truncated_description = self.aa_description.substr(0, 180) + '...';
				$timeout(function () {
					$scope.$digest();
				});
			});
		}

		this.hasDocs = function () {
			return !!(self.aa_description || self.aa_homepage_url || self.aa_source_url);
		}

		// a hack to force revalidation of amount field after asset is updated
		this.forceAmountRevalidation = function () {
			if ($scope.assetIndexSelectorValue >= 0)
				$timeout(function () {
					var form = $scope.sendPaymentForm;
					var val = form.amount.$modelValue;
					if (val) {
						form.amount.$setViewValue(val + '0');
						form.amount.$setViewValue(val + '');
					}
				});
		};

		this.getAssetBadge = function(asset) {
			var totalCounts = 0;
			if (indexScope.shared_address) {
				for (var unit in $rootScope.newPaymentsDetails) {
					var details = $rootScope.newPaymentsDetails[unit];
					if (details.receivedAddress === indexScope.shared_address && details.asset === asset) {
						totalCounts += $rootScope.newPaymentsCount[unit] || 0;
					}
				}
			} else {
			  	for(var unit in $rootScope.newPaymentsDetails) {
					var details = $rootScope.newPaymentsDetails[unit];
					if (details.walletId === indexScope.walletId
						&& details.walletAddress === details.receivedAddress
						&& details.asset === asset) {
						totalCounts += $rootScope.newPaymentsCount[unit] || 0;
					}
			  	}
			}
			return totalCounts;
		};

		this.onChanged = function () {
			if ($scope.assetIndexSelectorValue >= 0)
				$timeout(function () {
					lodash.debounce(updateAAResults, 500)();
				}, 100);
		};

	this.showDataFieldSuggestions = function (currentElem, index, arrayOfElements) {
      arrayOfElements.forEach((e, idx)=>{
        if(index !== idx) {
          e.suggestionsShown = false;
        }
      });
      arrayOfElements[index].suggestionsShown = true;
    };

		this.onMultiAddressesChanged = function () {
			var form = $scope.sendPaymentForm;
			var errors = form.addresses.$error;
			if (errors.validAddresses) // not valid yet
				return;
			var arrAddresses = getOutputsForMultiSend().map(function (output) { return output.address; });
			var aa_addresses = require('ocore/aa_addresses.js');
			aa_addresses.readAADefinitions(arrAddresses, function (rows) {
				form.addresses.$setValidity('noAA', rows.length === 0);
				$timeout(function() {
					$scope.$digest();
				});
			});
		};

		function addBounceFees(asset, amount, address) {
			if (!self.added_bounce_fees)
				self.added_bounce_fees = [];
			if (self.added_bounce_fees.filter(function (feeInfo) { return feeInfo.asset === asset; }).length === 0) {
				var feeInfo = {
					asset: asset,
					address: address,
					amount: amount,
					display_amount: profileService.formatAmountWithUnit(amount, asset, {dontRound: true})
				};
				self.added_bounce_fees.push(feeInfo);
			}
		}

		function dryRunPrimaryAATrigger(trigger, aa_address, arrDefinition, handleResponses) {
			if (!conf.bLight) {
				var aa_composer = require('ocore/aa_composer.js');
				return aa_composer.dryRunPrimaryAATrigger(trigger, aa_address, arrDefinition, function (arrResponses) {
					if (constants.COUNT_WITNESSES === 1) { // the temp unit might rebuild the MC
						var storage = require('ocore/storage.js');
						var db = require('ocore/db.js');
						db.executeInTransaction(function (conn, onDone) {
							storage.resetMemory(conn, onDone);
						});
					}
					handleResponses(null, arrResponses);
				});
			}
			network.requestFromLightVendor('light/dry_run_aa', { trigger: trigger, address: aa_address }, function (ws, request, response) {
				if (response.error)
					return handleResponses(response.error);
				var arrResponses = response;
				handleResponses(null, arrResponses);
			});
		}

		function updateAAResults () {
			var form = $scope.sendPaymentForm;
			var amount = form.amount.$modelValue || 0;
			if (!self.aa_destinations || self.aa_destinations.length === 0)
				return console.log('no AA destinations');

			var target_to_find = /trigger\.data\.[A-Za-z_0-9.]+/g; // Getting data field for keys suggestions
			var strDefinition = self.aa_destinations[0].base_definition || self.aa_destinations[0].definition;
			var data_fields_to_input = [... new Set (strDefinition.match(target_to_find))];
			if (data_fields_to_input.length) {
				var moreEntriesArray = []; // get third word, if object have > 3 entries
				var threeEntriesArray = []; // get all objects with 3 entries
				data_fields_to_input.forEach((e) => {
					var temp = e.split('.');
					if (temp.length >= 4) {
						moreEntriesArray.push(temp[2]);
					} else {
						threeEntriesArray.push(temp[2]);
					}
				});
				self.aa_data_fields_defined = lodash.difference(threeEntriesArray, moreEntriesArray); // filter 3 entry words with filter words;
			}
			if (self.aa_field_descriptions && Object.keys(self.aa_field_descriptions).length)
				self.aa_data_fields_defined = lodash.union(self.aa_data_fields_defined, Object.keys(self.aa_field_descriptions));

			var row = self.aa_destinations[0];
			var aa_address = row.address;
			var arrDefinition = JSON.parse(row.definition);
			var arrBaseDefinition = row.base_definition ? JSON.parse(row.base_definition) : arrDefinition;
			var bounce_fees = arrBaseDefinition[1].bounce_fees || { base: constants.MIN_BYTES_BOUNCE_FEE };
			if (!bounce_fees.base) {
				bounce_fees = lodash.clone(bounce_fees); // do not modify the definition
				bounce_fees.base = constants.MIN_BYTES_BOUNCE_FEE;
			}
			var address = indexScope.shared_address || self.addr[profileService.focusedClient.credentials.walletId];
			if (self.from_address && !indexScope.shared_address)
				address = self.from_address;
			if (!address)
				throw Error('no address');
			var trigger = { outputs: {}, address: address };
			if ($scope.home.feedvaluespairs.length > 0)
				trigger.data = {};
			$scope.home.feedvaluespairs.forEach(function(pair) {
				trigger.data[pair.name] = pair.value;
				trigger.data[pair.suggestionsShown] = false;
			});
			var assetInfo = $scope.index.arrBalances[$scope.index.assetIndex];
			var asset = assetInfo.asset;
			if (asset === "base")
				amount *= self.unitValue;
			else if (asset === constants.BLACKBYTES_ASSET)
				amount *= self.bbUnitValue;
			else if (assetInfo.decimals)
				amount *= Math.pow(10, assetInfo.decimals);
			amount = Math.round(amount);
			if (self.bSendAll)
				amount = assetInfo.total;
			if (amount < (bounce_fees[asset] || 0)) {
				if (amount === 0) {
					amount = bounce_fees[asset];
					form.amount.$setViewValue("" + profileService.getAmountInDisplayUnits(amount, asset));
					form.amount.$isValid = true;
					form.amount.$render();
					addBounceFees(asset, amount, aa_address);
				}
				else {
					self.custom_amount_error = gettext("Minimum amount") + " " + profileService.getAmountInDisplayUnits(bounce_fees[asset], asset);
					form.amount.$setValidity('aaBounceFees', false);
					form.amount.$render();
				}
			}
			else {
				self.custom_amount_error = null;
				if (amount > 0)
					form.amount.$setValidity('aaBounceFees', true);
			}
			if (!amount)
				return console.log('no amount yet');
			if (!$scope.sendPaymentForm.$valid)
				return console.log('form not valid yet');
			trigger.outputs[asset] = amount;
			for (var a in bounce_fees) {
				if (a !== asset) {
					addBounceFees(a, bounce_fees[a], aa_address);
					trigger.outputs[a] = bounce_fees[a];
				}
			}
			console.log("trigger", trigger);
			self.aa_dry_run_error = null;
			self.bEstimatingAAResults = true;
			dryRunPrimaryAATrigger(trigger, aa_address, arrDefinition, function (err, arrResponses) {
				self.aa_dry_run_error = err;
				var results = [];
				var state_changes = [];
				var responseVars = [];
				self.aa_message_results = results;
				self.aa_state_changes = state_changes;
				self.responseVars = responseVars;
				if (err) {
					// bEstimatingAAResults stays true
					return $timeout(function() {
						$scope.$digest();
					});
				}
				// the array includes the primary AA address too but it doesn't matter
				var arrSecondaryAAAdresses = arrResponses.map(function (objResponse) { return objResponse.aa_address; });
				arrResponses.forEach(function (objResponse) {
					if (objResponse.bounced)
						results.push(gettext("Bounce the request") + (objResponse.response.error ? ': ' + objResponse.response.error : ''));
					if (objResponse.updatedStateVars && objResponse.updatedStateVars[aa_address]) {
						for (var variable in objResponse.updatedStateVars[aa_address]) {
							var state_change = { variable: variable };
							var varInfo = objResponse.updatedStateVars[aa_address][variable];
							if (varInfo.delta > 0) {
								state_change.action = gettext('increased by');
								state_change.value = varInfo.delta;
							}
							else if (varInfo.delta < 0) {
								state_change.action = gettext('decreased by');
								state_change.value = -varInfo.delta;
							}
							else {
								state_change.action = gettext('set to');
								state_change.value = (typeof varInfo.value === 'object') ? JSON.stringify(varInfo.value) : varInfo.value;
							}
							state_changes.push(state_change);
						}
					}
					if (objResponse.response.responseVars) {
						for (var variable in objResponse.response.responseVars) {
							var value = objResponse.response.responseVars[variable];
							if (typeof value === 'string')
								value = value.replace(/\\n/g, '\n');
							responseVars.push({ variable: variable, value: value });
						}
					}
					if (!objResponse.objResponseUnit)
						return;
					objResponse.objResponseUnit.messages.forEach(function (message) {
						if (message.app === 'payment') {
							message.payload.outputs.forEach(function (output) {
								if (output.address === objResponse.aa_address) // change
									return;
								if (arrSecondaryAAAdresses.indexOf(output.address) >= 0) // to another AA
									return;
								var display_address = (output.address === objResponse.trigger_address) ? gettext('you') : output.address;
								var display_amount = profileService.formatAmountWithUnit(output.amount, message.payload.asset || "base", {dontRound: true});
								results.push(gettext("Send") + " " + display_amount + " " + gettext('to') + " " + display_address);
							});
						}
						else if (message.app === 'data_feed') {
							var pairs = [];
							for (var field in message.payload)
								pairs.push(field + ' = ' + message.payload[field]);
							results.push(gettext("Post a data feed ") + pairs.join(', '));
						}
						else if (message.app === 'data')
							results.push(gettext("Post data") + " " + JSON.stringify(message.payload));
						else if (message.app === 'asset') {
							results.push(gettext("Define a new asset with cap ") + (message.payload.cap || gettext('unlimited'))); // todo add more details
						}
						// todo add other apps
						else {
							results.push(gettext("Post a ") + message.app);
						}
					});
				});
				if (results.length === 0 && state_changes.length === 0 && responseVars.length === 0)
					results.push(gettext("none"));
				self.bEstimatingAAResults = false;
				$timeout(function() {
					$scope.$digest();
				});
			});
		}

		function getOutputsForMultiSend() {
			var outputs = [];
			var form = $scope.sendPaymentForm;
			var assetInfo = $scope.index.arrBalances[$scope.index.assetIndex];
			var asset = assetInfo.asset;
			var addressesValue = form.addresses.$modelValue ? form.addresses.$modelValue : '';
			addressesValue.split('\n').forEach(function(line){
				var tokens = line.trim().split(/[\s,;]/);
				var address = tokens[0];
				var amount = tokens.pop();
				if (asset === "base")
					amount *= self.unitValue;
				else if (assetInfo.decimals)
					amount *= Math.pow(10, assetInfo.decimals);
				amount = Math.round(amount);
				outputs.push({address: address, amount: +amount});
			});
			return outputs;
		}

		this.submitPayment = function() {
			if ($scope.index.arrBalances.length === 0)
				return console.log('send payment: no balances yet');
			var fc = profileService.focusedClient;
			var unitValue = this.unitValue;
			var bbUnitValue = this.bbUnitValue;

			if (isCordova && this.isWindowsPhoneApp) {
				this.hideAddress = false;
				this.hideAmount = false;
			}

			var form = $scope.sendPaymentForm;
			var isMultipleSend = !!form.addresses;
			if (!form)
				return console.log('form is gone');
			if (self.bSendAll)
				form.amount.$setValidity('validAmount', true);

			var resetAddressValidation = function(){};
			if ($scope.mtab == 2 && !isMultipleSend && !form.address.$modelValue) { // clicked 'share via message' button
				resetAddressValidation = function() {
					if (form && form.address)
						form.address.$setValidity('validAddressOrAccount', false);
				}
				form.address.$setValidity('validAddressOrAccount', true);
			}

			if (form.$invalid) {
				this.error = gettext('Unable to send transaction proposal');
				return;
			}

			var data_payload = {};
			var errored = false;
			$scope.home.feedvaluespairs.forEach(function(pair) {
				if (!pair.name) return;
				if (data_payload[pair.name]) {
					self.setSendError("All keys must be unique");
					errored = true;
					return;
				}
				data_payload[pair.name] = pair.value;
			});
			if (errored)
				return;
			var objDataMessage;
			if (Object.keys(data_payload).length > 0) {
				var objectHash = require('ocore/object_hash.js');
				var storage = require('ocore/storage.js');
				objDataMessage = {
					app: 'data',
					payload_location: "inline",
					payload_hash: objectHash.getBase64Hash(data_payload, storage.getMinRetrievableMci() >= constants.timestampUpgradeMci),
					payload: data_payload
				};
			}

			if (fc.isPrivKeyEncrypted()) {
				profileService.unlockFC(null, function(err) {
					if (err)
						return self.setSendError(err.message);
					return self.submitPayment();
				});
				return;
			}

			var comment = form.comment.$modelValue;

			// ToDo: use a credential's (or fc's) function for this
			if (comment) {
				var msg = 'Could not add message to imported wallet without shared encrypting key';
				$log.warn(msg);
				return self.setSendError(gettext(msg));
			}

			var wallet = require('ocore/wallet.js');
			var assetInfo = $scope.index.arrBalances[$scope.index.assetIndex];
			var asset = assetInfo.asset;
			console.log("asset " + asset);
			if (assetInfo.is_private && self.aa_destinations && self.aa_destinations.length > 0)
				return self.setSendError(gettext("It is not allowed to send private assets to autonomous agents"));
			if (self.binding && self.aa_destinations && self.aa_destinations.length > 0)
				return self.setSendError(gettext("It is not allowed to bind conditions to payments to autonomous agents"));

			if (conf.bLight && indexScope.copayers.length > 1 && indexScope.onGoingProcess['Syncing']) //wait for sync before sending
					return self.setSendError(gettext("wait for sync to complete before sending payments"));

			if (isMultipleSend) {
				if (assetInfo.is_private)
					return self.setSendError("private assets can not be sent to multiple addresses");
				var outputs = getOutputsForMultiSend();
				var current_payment_key = form.addresses.$modelValue.replace(/[^a-zA-Z0-9]/g, '');
			} else {
				var address = form.address.$modelValue;
				var recipient_device_address = assocDeviceAddressesByPaymentAddress[address];
				var amount = form.amount.$modelValue;
				// address can be [obyte_addr, email, account, empty => social sharing]
				var accountValidationResult = aliasValidationService.validate(address);
				var isEmail = ValidationUtils.isValidEmail(address);
				var isTextcoin = (isEmail || !address);

				var original_address;  // might be sent to email if the email address is attested
				if (isTextcoin)
					address = "textcoin:" + (address ? address : (Date.now() + "-" + amount));
				if (asset === "base")
					amount *= unitValue;
				else if (asset === constants.BLACKBYTES_ASSET)
					amount *= bbUnitValue;
				else if (assetInfo.decimals)
					amount *= Math.pow(10, assetInfo.decimals);
				amount = Math.round(amount);

				var current_payment_key = '' + asset + address + amount;
			}
			var merkle_proof = '';
			if (form.merkle_proof && form.merkle_proof.$modelValue)
				merkle_proof = form.merkle_proof.$modelValue.trim();

			if (current_payment_key === self.current_payment_key)
				return $rootScope.$emit('Local/ShowErrorAlert', "This payment is already under way");
			self.current_payment_key = current_payment_key;

			indexScope.setOngoingProcess(gettext('sending'), true);
			$timeout(function() {

				if (!isMultipleSend && accountValidationResult.isValid) { // try to replace validation result with attested BB address
					var attestorKey = accountValidationResult.attestorKey;
					var account = accountValidationResult.account;
					var bb_address = aliasValidationService.getBbAddress(
						attestorKey,
						account
					);
					console.log('attestorKey='+attestorKey+' : account='+account+' : bb_address='+bb_address);

					if (!bb_address) {
						return aliasValidationService.resolveValueToBbAddress(
							attestorKey,
							account,
							function () {
								// assocBbAddresses in aliasValidationService is now filled
								delete self.current_payment_key;
								self.submitPayment();
							}
						);
					}

					if (!isEmail) {

						if (bb_address === 'unknown' || bb_address === 'none') {
							if (bb_address === 'unknown') {
								aliasValidationService.deleteAssocBbAddress(
									attestorKey,
									account
								);
							}

							delete self.current_payment_key;
							indexScope.setOngoingProcess(gettext('sending'), false);
							return self.setSendError('Attested account not found');
						} else if (ValidationUtils.isValidAddress(bb_address)) {
							original_address = address;
							address = bb_address;
							isEmail = false;
							isTextcoin = false;
						} else {
							throw Error("unrecognized bb_address: "+bb_address);
						}

					} else {

						if (bb_address === 'unknown') {
							aliasValidationService.deleteAssocBbAddress(
								attestorKey,
								account
							); // send textcoin now but retry next time
						} else if (bb_address === 'none') {
							// go on to send textcoin
						} else if (ValidationUtils.isValidAddress(bb_address)) {
							original_address = account;
							address = bb_address;
							isEmail = false;
							isTextcoin = false;
						} else {
							throw Error("unrecognized bb_address: "+bb_address);
						}

					}
				}

				profileService.requestTouchid(function(err) {
					if (err) {
						profileService.lockFC();
						indexScope.setOngoingProcess(gettext('sending'), false);
						self.error = err;
						$timeout(function() {
							delete self.current_payment_key;
							$scope.$digest();
						}, 1);
						return;
					}

					var device = require('ocore/device.js');
					if (self.binding) {
						if (isTextcoin) {
							delete self.current_payment_key;
							indexScope.setOngoingProcess(gettext('sending'), false);
							return self.setSendError("you can send bound payments to Obyte adresses only");
						}
						if (!recipient_device_address)
							throw Error('recipient device address not known');
						var walletDefinedByAddresses = require('ocore/wallet_defined_by_addresses.js');
						var walletDefinedByKeys = require('ocore/wallet_defined_by_keys.js');
						var my_address;
						// never reuse addresses as the required output could be already present
						useOrIssueNextAddress(fc.credentials.walletId, 0, function(addressInfo) {
							my_address = addressInfo.address;
							if (self.binding.type === 'reverse_payment') {
								var arrSeenCondition = ['seen', {
									what: 'output',
									address: my_address,
									asset: self.binding.reverseAsset,
									amount: self.binding.reverseAmount
								}];
								var arrDefinition = ['or', [
									['and', [
										['address', address],
										arrSeenCondition
									]],
									['and', [
										['address', my_address],
										['not', arrSeenCondition],
										['timestamp', ['>', Math.round(Date.now()/1000 + self.binding.timeout * 3600)
										]]
									]]
								]];
								var assocSignersByPath = {
									'r.0.0': {
										address: address,
										member_signing_path: 'r',
										device_address: recipient_device_address
									},
									'r.1.0': {
										address: my_address,
										member_signing_path: 'r',
										device_address: device.getMyDeviceAddress()
									}
								};
							}
							else {
								if (self.binding.relation !== '=')
									self.binding.feed_type = 'explicit';
								if (self.binding.oracle_address === configService.TIMESTAMPER_ADDRESS)
									self.binding.feed_value = parseInt(self.binding.feed_value);
								var arrExplicitEventCondition =
									['in data feed', [
										[self.binding.oracle_address], self.binding.feed_name, self.binding.relation, self.binding.feed_value
									]];
								var arrMerkleEventCondition =
									['in merkle', [
										[self.binding.oracle_address], self.binding.feed_name, self.binding.feed_value
									]];
								var arrEventCondition;
								if (self.binding.feed_type === 'explicit')
									arrEventCondition = arrExplicitEventCondition;
								else if (self.binding.feed_type === 'merkle')
									arrEventCondition = arrMerkleEventCondition;
								else if (self.binding.feed_type === 'either')
									arrEventCondition = ['or', [arrMerkleEventCondition, arrExplicitEventCondition]];
								else
									throw Error("unknown feed type: " + self.binding.feed_type);
								var arrDefinition = ['or', [
									['and', [
										['address', address],
										arrEventCondition
									]],
									['and', [
										['address', my_address],
										['timestamp', ['>', Math.round(Date.now()/1000 + self.binding.timeout * 3600)
										]]
									]]
								]];
								var assocSignersByPath = {
									'r.0.0': {
										address: address,
										member_signing_path: 'r',
										device_address: recipient_device_address
									},
									'r.1.0': {
										address: my_address,
										member_signing_path: 'r',
										device_address: device.getMyDeviceAddress()
									}
								};
								if (self.binding.feed_type === 'merkle' || self.binding.feed_type === 'either')
									assocSignersByPath[(self.binding.feed_type === 'merkle') ? 'r.0.1' : 'r.0.1.0'] = {
										address: '',
										member_signing_path: 'r',
										device_address: recipient_device_address
									};
							}
							walletDefinedByAddresses.createNewSharedAddress(arrDefinition, assocSignersByPath, {
								ifError: function(err) {
									delete self.current_payment_key;
									indexScope.setOngoingProcess(gettext('sending'), false);
									self.setSendError(err);
								},
								ifOk: function(shared_address) {
									composeAndSend(shared_address);
								}
							});
						});
					}
					else
						composeAndSend(address);

					// compose and send
					function composeAndSend(to_address) {
						var arrSigningDeviceAddresses = []; // empty list means that all signatures are required (such as 2-of-2)
						if (fc.credentials.m < fc.credentials.n)
							$scope.index.copayers.forEach(function(copayer) {
								if (copayer.me || copayer.signs)
									arrSigningDeviceAddresses.push(copayer.device_address);
							});
						else if (indexScope.shared_address)
							arrSigningDeviceAddresses = indexScope.copayers.map(function(copayer) {
								return copayer.device_address;
							});
						breadcrumbs.add('sending payment in ' + asset);
						profileService.bKeepUnlocked = true;
						var opts = {
							shared_address: indexScope.shared_address,
							merkle_proof: merkle_proof,
							asset: asset,
							do_not_email: true,
							send_all: self.bSendAll,
							spend_unconfirmed: configWallet.spendUnconfirmed ? 'all' : 'own',
							arrSigningDeviceAddresses: arrSigningDeviceAddresses,
							recipient_device_address: recipient_device_address
						};
						if (self.from_address && !indexScope.shared_address)
							opts.paying_addresses = [self.from_address];
						if (!isMultipleSend) {
							opts.to_address = to_address;
							opts.amount = amount;
						} else {
							if (asset !== "base")
								opts.asset_outputs = outputs;
							else
								opts.base_outputs = outputs;
						}
						// add bounce fees if necessary
						if (self.added_bounce_fees && self.added_bounce_fees.length > 0) {
							var other_asset_added_bounce_fees = self.added_bounce_fees.filter(function (feeInfo) { return feeInfo.asset !== 'base' && feeInfo.asset !== asset; });
							if (other_asset_added_bounce_fees.length > 0) {
								delete self.current_payment_key;
								indexScope.setOngoingProcess(gettext('sending'), false);
								return self.setSendError("cannot add bounce fees in asset " + other_asset_added_bounce_fees[0].asset);
							}
							if (asset !== "base") { // add base_outputs to pay for bounce fees
								if (!isMultipleSend) {
									opts.asset_outputs = [{ address: to_address, amount: amount }];
									delete opts.to_address;
									delete opts.amount;
								}
								opts.base_outputs = self.added_bounce_fees.filter(function (feeInfo) { return feeInfo.asset === 'base'; }).map(function (feeInfo) { return { address: feeInfo.address, amount: feeInfo.amount }; });
							}
						}

						var filePath;
						if (assetInfo.is_private) {
							opts.getPrivateAssetPayloadSavePath = function(cb) {
								self.getPrivatePayloadSavePath(function(fullPath, cordovaPathObj){
									filePath = fullPath ? fullPath : (cordovaPathObj ? cordovaPathObj.root + cordovaPathObj.path + '/' + cordovaPathObj.fileName : null);
									cb(fullPath, cordovaPathObj);
								});
							};
						}
						if (objDataMessage)
							opts.messages = [objDataMessage];
						fc.sendMultiPayment(opts, function(err, unit, mnemonics) {
							// if multisig, it might take very long before the callback is called
							$rootScope.sentUnit = unit;
							indexScope.setOngoingProcess(gettext('sending'), false);
							breadcrumbs.add('done payment in ' + asset + ', err=' + err);
							delete self.current_payment_key;
							resetAddressValidation();
							profileService.bKeepUnlocked = false;
							if (err) {
								if (typeof err === 'object') {
									err = err.toString();
								//	err = JSON.stringify(err);
								//	eventBus.emit('nonfatal_error', "error object from sendMultiPayment: " + err, new Error());
								}
								else if (err.match(/device address/))
									err = "This is a private asset, please send it only by clicking links from chat";
								else if (err.match(/no funded/)) {
									if (self.from_address) {
										$rootScope.$emit('Local/ShowErrorAlert', "Not enough spendable funds on address " + self.from_address + ", you may want to refill its balance");
										self.resetForm(); // to enable to fill the form anew to refill this address
									}
									else
										err = "Not enough spendable funds, make sure all your funds are confirmed";
								}
								else if (err.match(/authentifier verification failed/))
									err = "Check that smart contract conditions are satisfied and signatures are correct";
								else if (err.match(/precommit/))
									err = err.replace('precommit callback failed: ', '');
								return self.setSendError(err);
							}
							var binding = self.binding;
							self.resetForm();
						//	$rootScope.$emit("NewOutgoingTx"); // we are already updating UI in response to new_my_transactions event which is triggered by broadcast
							if (original_address){
								var db = require('ocore/db.js');
								db.query("INSERT INTO original_addresses (unit, address, original_address) VALUES(?,?,?)",
									[unit, to_address, original_address]);
							}
							if (recipient_device_address) { // show payment in chat window
								eventBus.emit('sent_payment', recipient_device_address, amount || 'all', asset, !!binding);
								if (binding && binding.reverseAmount) { // create a request for reverse payment
									if (!my_address)
										throw Error('my address not known');
									var paymentRequestCode = 'obyte:' + my_address + '?amount=' + binding.reverseAmount + '&asset=' + encodeURIComponent(binding.reverseAsset);
									var paymentRequestText = '[reverse payment](' + paymentRequestCode + ')';
									device.sendMessageToDevice(recipient_device_address, 'text', paymentRequestText);
									var body = correspondentListService.formatOutgoingMessage(paymentRequestText);
									correspondentListService.addMessageEvent(false, recipient_device_address, body);
									device.readCorrespondent(recipient_device_address, function(correspondent) {
										if (correspondent.my_record_pref && correspondent.peer_record_pref) chatStorage.store(correspondent.device_address, paymentRequestText, 0);
									});

									// issue next address to avoid reusing the reverse payment address
									if (!fc.isSingleAddress) walletDefinedByKeys.issueNextAddress(fc.credentials.walletId, 0, function() {});
								}
							}
							else if (Object.keys(mnemonics).length) {
								var mnemonic = mnemonics[to_address];
								if (opts.send_all && asset === "base")
									amount = assetInfo.stable;

								self.openShareTextcoinModal(isEmail ? address.slice("textcoin:".length) : null, mnemonic, amount, asset, false, filePath);
								$rootScope.$emit('Local/SetTab', 'history');
							}
							else // redirect to history
								$rootScope.$emit('Local/SetTab', 'history');
						});

					}

					function useOrIssueNextAddress(wallet, is_change, handleAddress) {
						if (fc.isSingleAddress) {
							addressService.getAddress(fc.credentials.walletId, false, function(err, addr) {
								handleAddress({
									address: addr
								});
							});
						}
						else walletDefinedByKeys.issueNextAddress(wallet, is_change, handleAddress);
					}

				});
			}, 100);
		};

		$scope.$watch('index.assetIndex', function(newVal, oldVal) {
			$scope.assetIndexSelectorValue = newVal;
			self.switchForms();
		});
		this.switchForms = function() {
			 this.bSendAll = false;
			 if (this.send_multiple && $scope.index.arrBalances[$scope.index.assetIndex] && $scope.index.arrBalances[$scope.index.assetIndex].is_private)
			 	this.lockAmount = this.send_multiple = false;
			if ($scope.assetIndexSelectorValue < 0) {
				this.shownForm = 'data';
				if (!this.feedvaluespairs || this.feedvaluespairs.length === 0)
					this.feedvaluespairs = [{}];
				if ($scope.assetIndexSelectorValue === -6)
					$timeout(function () {
						if (self.definition && self.definition.length > 0)
							self.validateAADefinition();
					});
				if ($scope.assetIndexSelectorValue === -7)
					$timeout(function () {
						if (self.content && self.content.length > 0)
							self.validateTextLength();
					});
			}
			else {
				$scope.index.assetIndex = $scope.assetIndexSelectorValue;
				this.shownForm = 'payment';
				if (!this.feedvaluespairs || this.feedvaluespairs.length > 0 && (!this.feedvaluespairs[0].name || !this.feedvaluespairs[0].value))
					this.feedvaluespairs = [];
			}
			$scope.mtab = $scope.index.arrBalances[$scope.index.assetIndex] && $scope.index.arrBalances[$scope.index.assetIndex].is_private && !this.lockAddress ? 2 : 1;
		}

		this.submitData = function() {
			var objectHash = require('ocore/object_hash.js');
			var storage = require('ocore/storage.js');
			var fc = profileService.focusedClient;
			var value = {};
			var app;
			switch ($scope.assetIndexSelectorValue) {
				case -1:
					app = "data_feed";
					break;
				case -2:
					app = "attestation";
					break;
				case -3:
					app = "profile";
					break;
				case -4:
					app = "data";
					break;
				case -5:
					app = "poll";
					break;
				case -6:
					app = "definition";
					break;
				case -7:
					app = "text";
					break;
				default:
					throw new Error("invalid app selected");
			}
			var errored = false;
			$scope.home.feedvaluespairs.forEach(function(pair) {
				if (!pair.name) return;
				if (value[pair.name]) {
					self.setSendError("All keys must be unique");
					errored = true;
					return;
				}
				value[pair.name] = pair.value;
			});
			if (errored) return;
			if ($scope.assetIndexSelectorValue !== -6 && $scope.assetIndexSelectorValue !== -7) {
				if (Object.keys(value).length === 0) {
					self.setSendError("Provide at least one value");
					return;
				}
			}

			if (fc.isPrivKeyEncrypted()) {
				profileService.unlockFC(null, function(err) {
					if (err)
						return self.setSendError(err.message);
					return self.submitData();
				});
				return;
			}

			profileService.requestTouchid(function(err) {
				if (err) {
					profileService.lockFC();
					indexScope.setOngoingProcess(gettext('sending'), false);
					self.error = err;
					$timeout(function() {
						$scope.$digest();
					}, 1);
					return;
				}

				if (app == "attestation") {
					value = {
						address: $scope.home.attested_address,
						profile: value
					};
				}
				if (app == "poll") {
					value = {
						question: $scope.home.poll_question,
						choices: Object.keys(value)
					};
				}
				if (app == "definition") {
					parse_ojson.parse($scope.home.definition, function(err, arrDefinition) {
						if (err) {
							self.setSendError(err.toString());
							$timeout(function() {
								$scope.$digest();
							});
							return;
						}

						value = {
							definition: arrDefinition,
							address: objectHash.getChash160(arrDefinition)
						};
						sendData(value);
					});
					return;
				}
				if (app == "text") {
					value = $scope.home.content;
				}

				sendData(value);

				function sendData (value) {
					var objMessage = {
						app: app,
						payload_location: "inline",
						payload_hash: objectHash.getBase64Hash(value, storage.getMinRetrievableMci() >= constants.timestampUpgradeMci),
						payload: value
					};
					var arrSigningDeviceAddresses = []; // empty list means that all signatures are required (such as 2-of-2)
					if (fc.credentials.m < fc.credentials.n)
						indexScope.copayers.forEach(function(copayer) {
							if (copayer.me || copayer.signs)
								arrSigningDeviceAddresses.push(copayer.device_address);
						});
					else if (indexScope.shared_address)
						arrSigningDeviceAddresses = indexScope.copayers.map(function(copayer) {
							return copayer.device_address;
						});

					indexScope.setOngoingProcess(gettext('sending'), true);

					fc.sendMultiPayment({
						spend_unconfirmed: configWallet.spendUnconfirmed ? 'all' : 'own',
						arrSigningDeviceAddresses: arrSigningDeviceAddresses,
						shared_address: indexScope.shared_address,
						messages: [objMessage]
					}, function (err, unit) { // can take long if multisig
						$rootScope.sentUnit = unit;
						indexScope.setOngoingProcess(gettext('sending'), false);
						if (err) {
							self.setSendError(err);
							return;
						}
						breadcrumbs.add('done submitting data into feeds ' + Object.keys(value)
							.join(','));
						self.resetDataForm();
						$rootScope.$emit('Local/SetTab', 'history');
					});
				}
			});
		}

		this.resetDataForm = function() {
			this.resetError();
			$scope.home.feedvaluespairs = [{}];
			$timeout(function() {
				$rootScope.$digest();
			}, 1);
		};

		var assocDeviceAddressesByPaymentAddress = {};

		this.canSendExternalPayment = function() {
			if ($scope.index.arrBalances.length === 0 || $scope.index.assetIndex < 0) // no balances yet, assume can send
				return true;
			if (!$scope.index.arrBalances[$scope.index.assetIndex]) // no balances yet, assume can send
			 	return true;
			if (!$scope.index.arrBalances[$scope.index.assetIndex].is_private)
			 	return true;
			var form = $scope.sendPaymentForm;
			if (!form || !form.address) // disappeared
				return true;
			var address = form.address.$modelValue;
			var recipient_device_address = assocDeviceAddressesByPaymentAddress[address];
			return !!recipient_device_address;
		};

		this.deviceAddressIsKnown = function() {
			//	return true;
			if ($scope.index.arrBalances.length === 0) // no balances yet
				return false;
			var form = $scope.sendPaymentForm;
			if (!form || !form.address) // disappeared
				return false;
			var address = form.address.$modelValue;
			var recipient_device_address = assocDeviceAddressesByPaymentAddress[address];
			return !!recipient_device_address;
		};

		this.openBindModal = function() {
			$rootScope.modalOpened = true;
			var fc = profileService.focusedClient;
			var form = $scope.sendPaymentForm;
			if (!form || !form.address) // disappeared
				return;
			var address = form.address;

			var ModalInstanceCtrl = function($scope, $modalInstance) {
				$scope.color = fc.backgroundColor;
				$scope.arrRelations = ["=", ">", "<", ">=", "<=", "!="];
				$scope.arrPublicAssetInfos = indexScope.arrBalances.filter(function(b) {
						return !b.is_private;
					})
					.map(function(b) {
						var info = {
							asset: b.asset
						};
						if (b.asset === 'base')
							info.displayName = self.unitName;
						else if (b.asset === constants.BLACKBYTES_ASSET)
							info.displayName = self.bbUnitName;
						else if (profileService.assetMetadata[b.asset])
							info.displayName = profileService.assetMetadata[b.asset].name;
						else
							info.displayName = 'of ' + b.asset.substr(0, 4);
						return info;
					});
				$scope.binding = { // defaults
					type: fc.isSingleAddress ? 'data' : 'reverse_payment',
					timeout: 4,
					relation: '=',
					reverseAsset: 'base',
					feed_type: 'either'
				};
				if (self.binding) {
					$scope.binding.type = self.binding.type;
					$scope.binding.timeout = self.binding.timeout;
					if (self.binding.type === 'reverse_payment') {
						$scope.binding.reverseAsset = self.binding.reverseAsset;
						$scope.binding.reverseAmount = profileService.getAmountInDisplayUnits(self.binding.reverseAmount, self.binding.reverseAsset);
					}
					else {
						$scope.binding.oracle_address = self.binding.oracle_address;
						$scope.binding.feed_name = self.binding.feed_name;
						$scope.binding.relation = self.binding.relation;
						$scope.binding.feed_value = self.binding.feed_value;
						$scope.binding.feed_type = self.binding.feed_type;
					}
				}
				$scope.oracles = configService.oracles;
				$scope.isSingleAddress = fc.isSingleAddress;
				$scope.index = indexScope;

				$scope.cancel = function() {
					$modalInstance.dismiss('cancel');
				};

				$scope.bind = function() {
					var binding = {
						type: $scope.binding.type
					};
					if (binding.type === 'reverse_payment') {
						binding.reverseAsset = $scope.binding.reverseAsset;
						binding.reverseAmount = profileService.getAmountInSmallestUnits($scope.binding.reverseAmount, $scope.binding.reverseAsset);
					}
					else {
						binding.oracle_address = $scope.binding.oracle_address;
						binding.feed_name = $scope.binding.feed_name;
						binding.relation = $scope.binding.relation;
						binding.feed_value = $scope.binding.feed_value;
						binding.feed_type = $scope.binding.feed_type;
					}
					binding.timeout = $scope.binding.timeout;
					self.binding = binding;
					$modalInstance.dismiss('done');
				};

			};

			var modalInstance = $modal.open({
				templateUrl: 'views/modals/bind.html',
				windowClass: animationService.modalAnimated.slideUp,
				controller: ModalInstanceCtrl,
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

		this.setToAddress = function(to) {
			var form = $scope.sendPaymentForm;
			if (!form || !form.address) // disappeared?
				return console.log('form.address has disappeared');
			form.address.$setViewValue(to);
			form.address.$isValid = true;
			form.address.$render();
		}

		this.setForm = function(to, amount, comment, asset, recipient_device_address, base64data, from_address, single_address) {
			this.resetError();
			$timeout((function() {
				delete this.binding;
				var form = $scope.sendPaymentForm;
				if (!form || !form.address) // disappeared?
					return console.log('form.address has disappeared');
				if (form.merkle_proof) {
					form.merkle_proof.$setViewValue('');
					form.merkle_proof.$render();
				}
				if (comment) {
					form.comment.$setViewValue(comment);
					form.comment.$isValid = true;
					form.comment.$render();
				}

				if (base64data) {
					try {
						var paymentData = Buffer.from(base64data, 'base64').toString('utf8');
						paymentData = paymentData ? JSON.parse(paymentData) : null;
						if (paymentData) {
							$scope.home.feedvaluespairs = [];
							for (var key in paymentData) {
								$scope.home.feedvaluespairs.push({name: key, value: paymentData[key], readonly: true});
							}
						}
					}
					catch (e) {
						$rootScope.$emit('Local/ShowErrorAlert', "invalid data " + e.toString());
						return self.resetForm();
					}
				}

				if (from_address)
					this.from_address = from_address;

				if (asset) {
					if ($scope.index.arrBalances.length === 0) { // wait till balances are set
						console.log("no balances yet, will wait");
						self.resetForm();
						return $timeout(function () {
							self.setForm(to, amount, comment, asset, recipient_device_address, base64data, from_address, single_address);
						}, 1000);
					}
					var assetIndex = lodash.findIndex($scope.index.arrBalances, {
						asset: asset
					});
					if (assetIndex < 0) {
						$rootScope.$emit('Local/ShowErrorAlert', "failed to find asset index of asset " + asset);
						return self.resetForm();
					}
					$scope.index.assetIndex = assetIndex;
					$scope.assetIndexSelectorValue = assetIndex;
					this.lockAsset = true;
				}
				else
					this.lockAsset = false;

				$scope.mtab = 1;
				if (to) {
					form.address.$setViewValue(to);
					form.address.$isValid = true;
					form.address.$render();
					this.lockAddress = true;
					if (recipient_device_address) // must be already paired
						assocDeviceAddressesByPaymentAddress[to] = recipient_device_address;
					if ($scope.assetIndexSelectorValue < 0 && !asset) // a data form was selected
						$scope.assetIndexSelectorValue = 0;
				}

				this.switchForms();

				addressService.getAddress(profileService.focusedClient.credentials.walletId, false, function(err, my_address) {
					if (single_address && single_address !== '0'){
						var displayed_single_address = from_address ? ' '+from_address : '';
						var fc = profileService.focusedClient;
						if (!fc.isSingleAddress || from_address && from_address !== my_address) {
							$rootScope.$emit('Local/ShowErrorAlert', gettext("This payment must be paid only from single-address account")+displayed_single_address+".");
							return self.resetForm();
						}
					}
					$timeout((function () {
						if (amount) {
							//	form.amount.$setViewValue("" + amount);
							//	form.amount.$isValid = true;
							self.lockAmount = true;
							form.amount.$setViewValue("" + profileService.getAmountInDisplayUnits(amount, asset));
							form.amount.$isValid = true;
							form.amount.$render();
						}
						else  {
							self.lockAmount = false;
							form.amount.$setViewValue("");
							form.amount.$pristine = true;
							form.amount.$render();
						}
					}).bind(this));
				});
			}).bind(this), 1);
		};

		this.setDataForm = function (dataPrompt) {
			var app = dataPrompt.app;
			delete dataPrompt.app;
			this.resetError();
			$timeout((function() {
				switch (app) {
					case 'data_feed':
						$scope.assetIndexSelectorValue = -1;
						break;
					case 'attestation':
						$scope.assetIndexSelectorValue = -2;
						$scope.home.attested_address = dataPrompt.address;
						delete dataPrompt.address;
						break;
					case 'profile':
						$scope.assetIndexSelectorValue = -3;
						break;
					case 'data':
						$scope.assetIndexSelectorValue = -4;
						break;
					case 'poll':
						$scope.assetIndexSelectorValue = -5;
						$scope.home.poll_question = dataPrompt.question;
						delete dataPrompt.question;
						break;
					case 'vote':
						$rootScope.$emit('Local/ShowErrorAlert', 'voting not yet supported via uri');
						return self.resetForm();
					case 'definition':
						$scope.assetIndexSelectorValue = -6;
						$scope.home.definition = dataPrompt.definition;
						delete dataPrompt.definition;
						break;
					case 'text':
						$scope.assetIndexSelectorValue = -7;
						$scope.home.content = dataPrompt.content;
						delete dataPrompt.content;
						break;
				}
				$scope.home.feedvaluespairs = [];
				for (var key in dataPrompt) {
					var value = dataPrompt[key];
					$scope.home.feedvaluespairs.push(app === 'poll' ? {name: value, value: 'anything', readonly: true} : {name: key, value: value, readonly: true});
				}
				this.switchForms();
			//	$timeout(function () {
			//		$rootScope.$digest();
			//	})
			}).bind(this), 1);
		};

		this.resetForm = function(bKeepData) {
			this.resetError();
			delete this.binding;

			this.lockAsset = false;
			this.lockAddress = false;
			this.lockAmount = false;
			this.hideAdvSend = true;
			this.send_multiple = false;
			this.from_address = null;

			this._amount = this._address = null;
			this.bSendAll = false;
			if (!bKeepData)
				this.feedvaluespairs = [];
			resetAAFields();

			var form = $scope.sendPaymentForm;
			var self = this;

			$timeout(function() {
				if (form && form.amount) {
					if (!$scope.$root) $scope.$root = {};
					form.amount.$pristine = true;
					if (form.amount) {
						form.amount.$setViewValue('');
						form.amount.$render();
					}

					if (form.merkle_proof) {
						form.merkle_proof.$setViewValue('');
						form.merkle_proof.$render();
					}
					if (form.comment) {
						form.comment.$setViewValue('');
						form.comment.$render();
					}
					form.$setPristine();

					if (form.address) {
						form.address.$setPristine();
						form.address.$setViewValue('');
						form.address.$render();
					}
				}
				self.switchForms();
				$timeout(function() {
					$rootScope.$digest();
				}, 1);
			});
		};

		this.setSendAll = function() {
			var form = $scope.sendPaymentForm;
			if (!form || !form.amount) // disappeared?
				return console.log('form.amount has disappeared');
			if (indexScope.arrBalances.length === 0)
				return;
			var assetInfo = indexScope.arrBalances[indexScope.assetIndex];
			if (assetInfo.asset === 'base') {
				this._amount = null;
				this.bSendAll = true;
				form.amount.$setViewValue('');
				form.amount.$setValidity('validAmount', true);
				form.amount.$render();
			}
			else {
				var full_amount = assetInfo.total;
				if (assetInfo.asset === constants.BLACKBYTES_ASSET)
					full_amount /= this.bbUnitValue;
				else if (assetInfo.decimals)
					full_amount /= Math.pow(10, assetInfo.decimals);
				form.amount.$setViewValue('' + full_amount);
				form.amount.$render();
			}
			//console.log('done setsendall')
			/*$timeout(function() {
				$rootScope.$digest();
				console.log('-- amount invalid? '+form.amount.$invalid);
				console.log('-- form invalid? '+form.$invalid);
			}, 1);*/
		};

		this.setFromUri = function(uri) {
			var objRequest;
			require('ocore/uri.js')
				.parseUri(uri, {
					ifError: function(err) {},
					ifOk: function(_objRequest) {
						objRequest = _objRequest; // the callback is called synchronously
					}
				});

			if (!objRequest) // failed to parse
				return uri;
			if (objRequest.amount) {
				// setForm() cares about units conversion
				//var amount = (objRequest.amount / this.unitValue).toFixed(this.unitDecimals);
				this.setForm(objRequest.address, objRequest.amount);
			}
			return objRequest.address;
		};

		this.onAddressChange = function(value) {
			this.resetError();
			if (!value) return '';

			if (value.indexOf(self.protocol + ':') === 0 || value.indexOf(self.bb_protocol + ':') === 0)
				return this.setFromUri(value);
			else
				return value;
		};

		// History

		function strip(number) {
			return (parseFloat(number.toPrecision(12)));
		}

		this.getUnitName = function() {
			return this.unitName;
		};

		this.getPrivatePayloadSavePath = function(cb) {
			var fileName = 'ObytePayment-' + $filter('date')(Date.now(), 'yyyy-MM-dd-HH-mm-ss') + '.' + configService.privateTextcoinExt;
			if (!isCordova) {
				var inputFile = document.createElement("input");
				inputFile.type = "file";
				inputFile.setAttribute("nwsaveas", fileName);
				inputFile.click();
				var wasCalled = false;
				inputFile.onchange = function() {
					if (wasCalled) return;
					wasCalled = true;
					$timeout(function() {
						cb(inputFile.value ? inputFile.value : null);
						window.removeEventListener('focus', inputFile.onchange, true);
					}, 1000);
				};
				window.addEventListener('focus', inputFile.onchange, true);
			}
			else {
				var root = window.cordova.file.cacheDirectory;//isMobile.iOS() ? window.cordova.file.documentsDirectory : window.cordova.file.externalRootDirectory;
				var path = 'Obyte';
				cb(null, {root: root, path: path, fileName: fileName});
			}
		};

		this.openInExplorer = correspondentListService.openInExplorer;

		this.sendAttachedFile = function ($ev) {
			home.attachedFile = $ev.target.files[0];
			if (!home.attachedFile) 
				return;
			var read = isCordova
				? (file, cb) => fileSystemService.readFileFromForm(file, cb)
				: (file, cb) => fileSystemService.readFile(file.path, cb);
			read(home.attachedFile, function (
				err,
				data
			) {
				if (err) {
					self.setSendError("cannot read the file whose hash is going to be posted");
					return;
				}
				const hash = require("crypto")
					.createHash("sha256")
					.update(data)
					.digest("hex");
				// if the last element is empty, remove it
				if (home.feedvaluespairs.length > 0) {
					var last_pair = home.feedvaluespairs[home.feedvaluespairs.length - 1];
					if (!last_pair.name && !last_pair.value)
						home.feedvaluespairs.pop();
				}
				home.feedvaluespairs.push({
					name: home.attachedFile.name,
					value: hash,
				});
				$scope.$apply();
			});
		};

		this.openTxModal = function(btx) {
			$rootScope.modalOpened = true;
			delete $rootScope.newPaymentsCount[btx.unit];
			delete $rootScope.newPaymentsDetails[btx.unit];
			var self = this;
			var fc = profileService.focusedClient;
			var ModalInstanceCtrl = function($scope, $modalInstance) {
				$scope.btx = btx;
				$scope.btx.response = typeof btx.response === 'string' ? JSON.parse(btx.response) : btx.response;
				var assetIndex = lodash.findIndex(indexScope.arrBalances, {
					asset: btx.asset
				});
				$scope.addressbook = indexScope.addressbook;
				$scope.isPrivate = indexScope.arrBalances[assetIndex].is_private;
				$scope.Math = window.Math;
				$scope.assetDecimals = indexScope.arrBalances[assetIndex].decimals;
				$scope.settings = walletSettings;
				$scope.color = fc.backgroundColor;
				$scope.n = fc.credentials.n;
				$scope.exchangeRates = network.exchangeRates;
				$scope.BLACKBYTES_ASSET = constants.BLACKBYTES_ASSET;

				var storage = require('ocore/storage.js');
				storage.readUnit(btx.unit, function (objUnit) {
					if (!objUnit)
						throw Error("unit " + btx.unit + " not found");
					var dataMessage = objUnit.messages.find(m => m.app === 'data');
					var dataFeedMessage = objUnit.messages.find(m => m.app === 'data_feed');
					var attestationMessage = objUnit.messages.find(m => m.app === 'attestation');
					var profileMessage = objUnit.messages.find(m => m.app === 'profile');
					var definitionMessage = objUnit.messages.find(m => m.app === 'definition');
					if (dataMessage)
						btx.dataJson = JSON.stringify(dataMessage.payload, null, 2);
					if (dataFeedMessage)
						btx.dataFeedJson = JSON.stringify(dataFeedMessage.payload, null, 2);
					if (attestationMessage)
						btx.attestationJson = JSON.stringify(attestationMessage.payload, null, 2);
					if (profileMessage)
						btx.profileJson = JSON.stringify(profileMessage.payload, null, 2);
					if (definitionMessage)
						btx.aaDefinitionPreview = definitionMessage.payload.address + '\n' + JSON.stringify(definitionMessage.payload.definition).substr(0, 200) + '...';
					$timeout(function () {
						$scope.$apply();
					});
				});

				var setAADescription = function (aa_address, field) {
					readAADefinitionsWithBaseDefinitions(aa_address, rows => {
						var row = rows[0];
						if (!row)
							return;
						aaDocService.getAADocs(row.address, row.base_definition || row.definition, doc => {
							if (!doc)
								return;
							btx[field] = (doc.description.length > 120) ? doc.description.substr(0, 117) + '...' : doc.description;
							$timeout(function () {
								$scope.$digest();
							});
						});
					});
				};

				if (btx.to_aa && btx.addressTo)
					setAADescription(btx.addressTo, 'to_aa_description');
				if (btx.from_aa)
					setAADescription(btx.arrPayerAddresses[0], 'from_aa_description');

				$scope.shareAgain = function() {
					if ($scope.isPrivate) {
						var indivisible_asset = require('ocore/indivisible_asset');
						var wallet = require('ocore/wallet.js');
						indivisible_asset.restorePrivateChains(btx.asset, btx.unit, btx.addressTo, function(arrRecipientChains, arrCosignerChains){
							self.getPrivatePayloadSavePath(function(fullPath, cordovaPathObj){
								if (!fullPath && !cordovaPathObj)
									return;
								var filePath = fullPath ? fullPath : (cordovaPathObj.root + cordovaPathObj.path + '/' + cordovaPathObj.fileName);
								wallet.storePrivateAssetPayload(fullPath, cordovaPathObj, btx.mnemonic, arrRecipientChains, function(err) {
									if (err)
										throw Error(err);
									self.openShareTextcoinModal(btx.textAddress, btx.mnemonic, btx.amount, btx.asset, true, filePath);
								});
							});
						});
					} else
						self.openShareTextcoinModal(btx.textAddress, btx.mnemonic, btx.amount, btx.asset, true);
				}

				$scope.eraseTextcoin = function() {
					(function(){
						var wallet = require('ocore/wallet.js');
						var ModalInstanceCtrl = function($scope, $modalInstance, $sce) {
							$scope.title = gettextCatalog.getString('Deleting the textcoin will remove the ability to claim it back or resend');
							$scope.cancel_button_class = 'light-gray outline';
							$scope.loading = false;
							$scope.confirm_label = gettextCatalog.getString('Confirm');

							$scope.ok = function() {
								$scope.loading = true;
								$modalInstance.close(gettextCatalog.getString('Confirm'));

								wallet.eraseTextcoin(btx.unit, btx.addressTo);

								indexScope.updateTxHistory();
								$rootScope.$emit('Local/SetTab', 'history');
							};
							$scope.cancel = function() {
								$modalInstance.dismiss(gettextCatalog.getString('No'));
							};
						};

						var modalInstance = $modal.open({
							templateUrl: 'views/modals/confirmation.html',
							windowClass: animationService.modalAnimated.slideUp,
							controller: ModalInstanceCtrl
						});

						modalInstance.result.finally(function() {
							var m = angular.element(document.getElementsByClassName('reveal-modal'));
							m.addClass(animationService.modalAnimated.slideOutDown);
						});
					})();
				}

				$scope.resend = function(btx) {
					if (!btx) return;
					$scope.cancel();
					self.resend(btx);
				};

				$scope.getAmount = function(amount) {
					return self.getAmount(amount);
				};

				$scope.getUnitName = function() {
					return self.getUnitName();
				};

				$scope.openInExplorer = function(unit) {
					return self.openInExplorer(unit);
				};

				$scope.copyAddress = function(addr) {
					if (!addr) return;
					self.copyAddress(addr);
				};

				$scope.getToAddressLabel = function(value) {
					return indexScope.getToAddressLabel(value);
				};
				$scope.getAddressValue = function(value) {
					return indexScope.getAddressValue(value);
				};

				$scope.showCorrespondentList = function() {
					self.showCorrespondentListToReSendPrivPayloads(btx);
				};

				$scope.reSendPrivateMultiSigPayment = function() {
					var indivisible_asset = require('ocore/indivisible_asset');
					var wallet_defined_by_keys = require('ocore/wallet_defined_by_keys');
					var walletDefinedByAddresses = require('ocore/wallet_defined_by_addresses');
					var fc = profileService.focusedClient;

					function success() {
						$timeout(function() {
							notification.success(gettextCatalog.getString('Success'), gettextCatalog.getString('Private payloads sent', {}));
						});
					}

					indivisible_asset.restorePrivateChains(btx.asset, btx.unit, btx.addressTo, function(arrRecipientChains, arrCosignerChains) {
						if (indexScope.shared_address) {
							walletDefinedByAddresses.forwardPrivateChainsToOtherMembersOfAddresses(arrCosignerChains, [indexScope.shared_address], true, null, success);
						}
						else {
							wallet_defined_by_keys.forwardPrivateChainsToOtherMembersOfWallets(arrCosignerChains, [fc.credentials.walletId], true, null, success);
						}
					});
				};

				$scope.cancel = function() {
					breadcrumbs.add('dismiss tx details');
					try {
						$modalInstance.dismiss('cancel');
					}
					catch (e) {
						//	indexScope.sendBugReport('simulated in dismiss tx details', e);
					}
				};

			};

			var modalInstance = $modal.open({
				templateUrl: 'views/modals/tx-details.html',
				windowClass: animationService.modalAnimated.slideRight,
				controller: ModalInstanceCtrl,
			});

			var disableCloseModal = $rootScope.$on('closeModal', function() {
				breadcrumbs.add('on closeModal tx details');
				modalInstance.dismiss('cancel');
			});

			modalInstance.result.finally(function() {
				$rootScope.modalOpened = false;
				disableCloseModal();
				var m = angular.element(document.getElementsByClassName('reveal-modal'));
				m.addClass(animationService.modalAnimated.slideOutRight);
			});
		};

		this.showCorrespondentListToReSendPrivPayloads = function(btx) {
			$rootScope.modalOpened = true;
			var self = this;
			var fc = profileService.focusedClient;
			var ModalInstanceCtrl = function($scope, $modalInstance, $timeout, go, notification) {
				$scope.btx = btx;
				$scope.settings = walletSettings;
				$scope.color = fc.backgroundColor;

				$scope.readList = function() {
					$scope.error = null;
					correspondentListService.list(function(err, ab) {
						if (err) {
							$scope.error = err;
							return;
						}
						$scope.list = ab;
						$timeout(function(){
							$scope.$digest();
						});
					});
				};

				$scope.sendPrivatePayments = function(correspondent) {
					var indivisible_asset = require('ocore/indivisible_asset');
					var wallet_general = require('ocore/wallet_general');
					indivisible_asset.restorePrivateChains(btx.asset, btx.unit, btx.addressTo, function(arrRecipientChains, arrCosignerChains) {
						wallet_general.sendPrivatePayments(correspondent.device_address, arrRecipientChains, true, null, function() {
							modalInstance.dismiss('cancel');
							go.history();
							$timeout(function() {
								notification.success(gettextCatalog.getString('Success'), gettextCatalog.getString('Private payloads sent', {}));
							});
						});
					});

				};

				$scope.back = function() {
					self.openTxModal(btx);
				};

			};

			var modalInstance = $modal.open({
				templateUrl: 'views/modals/correspondentListToReSendPrivPayloads.html',
				windowClass: animationService.modalAnimated.slideRight,
				controller: ModalInstanceCtrl,
			});

			var disableCloseModal = $rootScope.$on('closeModal', function() {
				modalInstance.dismiss('cancel');
			});

			modalInstance.result.finally(function() {
				$rootScope.modalOpened = false;
				disableCloseModal();
				var m = angular.element(document.getElementsByClassName('reveal-modal'));
				m.addClass(animationService.modalAnimated.slideOutRight);
			});
		};

		this.hasAction = function(actions, action) {
			return actions.hasOwnProperty('create');
		};


		this.getDollarValue = function(amount, balanceObject) {
			function getResult(exchangePair) {
				if (home.bSendAll && home.from_address)
					return; // TEMP fix: don't show value if from specific address and "All minus fee" shown
				var result = 0;
				if (exchangePair === 'GBYTE_USD' || exchangePair === 'GBB_USD') {
					var amountInSmallestUnits = profileService.getAmountInSmallestUnits(amount, balanceObject.asset);
					result = amountInSmallestUnits / 1e9 * home.exchangeRates[exchangePair];
					if (home.bSendAll) {
						amountInSmallestUnits = balanceObject.stable;
						result = amountInSmallestUnits / 1e9 * home.exchangeRates[exchangePair];
					}
				} else {
					result = amount * home.exchangeRates[exchangePair];
				}
				if (!isNaN(result) && result !== 0) {
					if(result >= 0.1) {
						return `≈$${result.toLocaleString([], {maximumFractionDigits: 2})}`;
					}
					if(result < 0.1) {
						return `≈$${result.toPrecision(2)}`;
					}
				}
			}

			if (balanceObject.asset === 'base') {
				return getResult('GBYTE_USD');
			} else if(balanceObject.asset === $scope.index.BLACKBYTES_ASSET) {
				return getResult('GBB_USD');
			}
			else if(home.exchangeRates[balanceObject.asset + '_USD']) {
				return getResult(balanceObject.asset + '_USD');
			}
		};
  
		$scope.calculateAmount = function(amount, asset) {
			var assetInfo = indexScope.arrBalances[indexScope.assetIndex];
			if (asset === "base")
				return '' + amount / self.unitValue;
			else if (asset === constants.BLACKBYTES_ASSET)
				return '' + amount / self.bbUnitValue;
			else if (assetInfo.decimals)
				return '' + amount / Math.pow(10, assetInfo.decimals);
			return amount;
		};
  
		this.resend = function(btx) {
			$rootScope.$emit('Local/SetTab', 'send');
			this.resetError();
			delete this.binding;

			this.lockAsset = false;
			this.lockAddress = false;
			this.lockAmount = false;
			this.hideAdvSend = true;
			this.send_multiple = false;
			this.from_address = null;

			this._amount = this._address = null;
			this.bSendAll = false;
			$scope.home.feedvaluespairs = [];
			resetAAFields();
			var form = $scope.sendPaymentForm;
			if (!form)
				return console.log('form is gone');
			if (!$scope.$root) $scope.$root = {};
			if (form.address) {
				form.address.$setViewValue(btx.addressTo);
				form.address.$render();
			}
			if (form.merkle_proof) {
				form.merkle_proof.$setViewValue('');
				form.merkle_proof.$render();
			}
			if (form.comment) {
				form.comment.$setViewValue('');
				form.comment.$render();
			}
			var storage = require('ocore/storage.js');
			var db = require('ocore/db.js');
			function ifFound(objJoint) {
				$timeout(function() {
					var dataMessages = objJoint.unit.messages.filter(message => message.app !== 'payment');
					var paymentMessages = objJoint.unit.messages.filter(message => message.app === 'payment');
					var getTxType = function () {
						if (dataMessages.length === 0)
							return 'payment';
						var fc = profileService.focusedClient;
						if (!fc.isSingleAddress)
							return 'payment_with_data';
						if (paymentMessages.length > 1)
							return 'payment_with_data';
						var outputs = paymentMessages[0].payload.outputs;
						if (outputs.length > 1)
							return 'payment_with_data';
						if (btx.addressTo === self.addr[fc.credentials.walletId])
							return 'data';
						return 'payment_with_data';
					};
					var txType = getTxType();
					if (txType !== 'data')
						$scope.assetIndexSelectorValue = $scope.index.assetIndex;
					if (dataMessages.length > 0) {
						var payload = dataMessages[0].payload;
						var data;
						switch (dataMessages[0].app) {
							case 'data_feed':
								$scope.assetIndexSelectorValue = -1;
								data = payload;
								break;
							case 'attestation':
								$scope.assetIndexSelectorValue = -2;
								$scope.home.attested_address = payload.address;
								data = payload.profile;
								break;
							case 'profile':
								$scope.assetIndexSelectorValue = -3;
								data = payload;
								break;
							case 'data':
								if (txType === 'data')
									$scope.assetIndexSelectorValue = -4;
								data = payload;
								break;
							case 'poll':
								$scope.assetIndexSelectorValue = -5;
								$scope.home.poll_question = payload.question;
								data = payload.choices;
								break;
							case 'vote':
								$rootScope.$emit('Local/ShowErrorAlert', 'voting not yet supported via uri');
								return self.resetForm();
							case 'definition':
								var stringUtils = require('ocore/string_utils.js');
								$scope.assetIndexSelectorValue = -6;
								var jsonDefinition = stringUtils.getJsonSourceString(payload.definition[1], false);
								$scope.home.definition = jsonDefinition.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
								data = {};
								break;
							case 'text':
								$scope.assetIndexSelectorValue = -7;
								$scope.home.content = payload;
								data = {};
								break;
						}
						$scope.home.feedvaluespairs = [];
						for (var key in data) {
							var value = data[key];
							$scope.home.feedvaluespairs.push(dataMessages[0].app === 'poll' ? {name: value, value: 'anything', readonly: false} : {name: key, value: value, readonly: false});
						}
					}
					if ($scope.assetIndexSelectorValue >= 0) {
						if (form.amount) {
							form.amount.$setViewValue("" + $scope.calculateAmount(btx.amount, btx.asset));
							form.amount.$render();
						}
					}
						
					self.switchForms();
				});
			};
			function ifNotFound() {
				throw Error("tx " + btx.unit + " not found");
			}
			storage.readJoint(db, btx.unit, ({ifFound: ifFound, ifNotFound: ifNotFound}), false);
		};

		/* Start setup */

		this.bindTouchDown();
		this.setSendPaymentFormInputs();
		if (profileService.focusedClient && profileService.focusedClient.isComplete()) {
			this.setAddress();
		}

		var store_mnemonic_back = function(){};
		if (isCordova){
			window.plugins.appPreferences.fetch(function(referrer){
				if (referrer) {
					console.log('==== referrer: '+referrer);
					window.plugins.appPreferences.remove(function(){}, function(){}, 'referrer');
					store_mnemonic_back = function() {
						window.plugins.appPreferences.store(function(){}, function(){}, 'referrer', referrer);
					};
					if (referrer.split('-').length % 3 === 0)
						$rootScope.$emit("claimTextcoin", referrer);
				}
			}, function(){}, "referrer");
		}
	});
