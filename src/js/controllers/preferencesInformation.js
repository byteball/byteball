'use strict';

angular.module('copayApp.controllers').controller('preferencesInformation',
  function($scope, $rootScope, $log, $timeout, $modal, isMobile, gettextCatalog, lodash, profileService, storageService, animationService, go, configService, correspondentListService) {
    var fc = profileService.focusedClient;
    var c = fc.credentials;
    var indexScope = $scope.index;

    this.init = function() {
      var basePath = c.getBaseAddressDerivationPath();
      var config = configService.getSync().wallet.settings;

      $scope.walletName = c.walletName;
      $scope.walletId = c.walletId;
      $scope.network = c.network;
      $scope.derivationStrategy = c.derivationStrategy || 'BIP44';
      $scope.basePath = basePath;
      $scope.M = c.m;
      $scope.N = c.n;
      $scope.addrs = null;

      fc.getAddresses({
        doNotVerify: true
      }, function(err, addrs) {
        if (err) {
          $log.warn(err);
          return;
        };
        /*var last10 = [],
          i = 0,
          e = addrs.pop();
        while (i++ < 10 && e) {
          e.path = e.path;
          last10.push(e);
          e = addrs.pop();
        }
        $scope.addrs = last10;*/
        $scope.addrs = addrs;
        $timeout(function() {
          $scope.$apply();
        });

      });
      
      fc.getListOfBalancesOnAddresses(function(listOfBalances) {
        var hiddenAssets = indexScope.getCurrentWalletHiddenAssets();
        listOfBalances = listOfBalances.filter(function(row) {
          if (indexScope.isAssetHidden(row.asset, hiddenAssets)) return false;
          return true;
        }).map(function(row) {
          row.amount = profileService.formatAmountWithUnit(row.amount, row.asset, {dontRound: true});
          return row;
        });
        //groupBy address
        var assocListOfBalances = {};
        listOfBalances.forEach(function(row) {
          if (assocListOfBalances[row.address] === undefined) assocListOfBalances[row.address] = [];
          assocListOfBalances[row.address].push(row);
        });
        $scope.assocListOfBalances = assocListOfBalances;
        $timeout(function() {
          $scope.$apply();
        });
      });
    };

    $scope.signMessageFromAddress = function(address) {
      correspondentListService.signMessageFromAddress('This is my wallet address', address, indexScope.getSigningDeviceAddresses(fc), false, function(err, signedMessageBase64){
        if (err) {
          return $rootScope.$emit('Local/ShowErrorAlert', err);
        }
        console.log(signedMessageBase64);
        $scope.verifySignedMessage(signedMessageBase64);
      });
    };

    $scope.verifySignedMessage = function(signedMessageBase64){
      $rootScope.modalOpened = true;
      var self = this;
      var fc = profileService.focusedClient;
      var signedMessageJson = Buffer.from(signedMessageBase64, 'base64').toString('utf8');
      var objSignedMessage = JSON.parse(signedMessageJson);
      
      var ModalInstanceCtrl = function($scope, $modalInstance) {
        $scope.color = fc.backgroundColor;
        $scope.signed_message = objSignedMessage.signed_message;
        $scope.address = objSignedMessage.authors[0].address;
        $scope.signature = signedMessageBase64;
        var validation = require('ocore/validation.js');
        validation.validateSignedMessage(objSignedMessage, function(err){
          $scope.bValid = !err;
          if (err)
            console.log("validateSignedMessage: "+err);
          scopeApply();
        });
        
        function scopeApply(){
          $timeout(function(){
            $scope.$apply();
          });
        }
  
        $scope.cancel = function() {
          $modalInstance.dismiss('cancel');
        };
      };
      
      
      var modalInstance = $modal.open({
        templateUrl: 'views/modals/signed-message.html',
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
      
    }; // verifySignedMessage

    $scope.isString = function(variable) {
      return typeof variable === 'string';
    };
  
    $scope.prettyPrint = function(variable) {
      return $scope.isString(variable) ? variable : JSON.stringify(variable, null, '\t');
    };

    $scope.hasListOfBalances = function() {
      return !!Object.keys($scope.assocListOfBalances || {}).length;
    };

    $scope.useAsFromAddress = function(from_address, asset) {
      go.send(function () {
        $rootScope.$emit('paymentRequest', null, null, asset, null, null, from_address);
      });
    };

    this.sendAddrs = function() {
      var self = this;

      if (isMobile.Android() || isMobile.Windows()) {
        window.ignoreMobilePause = true;
      }

      self.loading = true;

      function formatDate(ts) {
        var dateObj = new Date(ts * 1000);
        if (!dateObj) {
          $log.debug('Error formating a date');
          return 'DateError';
        }
        if (!dateObj.toJSON()) {
          return '';
        }
        return dateObj.toJSON();
      };

      $timeout(function() {
        fc.getAddresses({
          doNotVerify: true
        }, function(err, addrs) {
          self.loading = false;
          if (err) {
            $log.warn(err);
            return;
          };

          var body = 'Obyte Account "' + $scope.walletName + '" Addresses.\n\n';
          body += "\n";
          body += addrs.map(function(v) {
            return ('* ' + v.address + ' ' + v.path + ' ' + formatDate(v.createdOn));
          }).join("\n");

          window.plugins.socialsharing.shareViaEmail(
            body,
            'Obyte Addresses',
            null, // TO: must be null or an array
            null, // CC: must be null or an array
            null, // BCC: must be null or an array
            null, // FILES: can be null, a string, or an array
            function() {},
            function() {}
          );

          $timeout(function() {
            $scope.$apply();
          }, 1000);
        });
      }, 100);
    };

    this.clearTransactionHistory = function() {
        $scope.$emit('Local/ClearHistory');

        $timeout(function() {
          go.walletHome();
        }, 100);
    }
  });
