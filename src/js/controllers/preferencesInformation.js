'use strict';

angular.module('copayApp.controllers').controller('preferencesInformation',
  function($scope, $log, $timeout, isMobile, gettextCatalog, lodash, profileService, storageService, go) {
    var fc = profileService.focusedClient;
    var c = fc.credentials;

    this.init = function() {
      var basePath = c.getBaseAddressDerivationPath(); 

      $scope.walletName = c.walletName;
      $scope.walletId = c.walletId;
      $scope.network = c.network;
      $scope.derivationStrategy = c.derivationStrategy || 'BIP44';
      $scope.basePath = basePath;
      $scope.M = c.m;
      $scope.N = c.n;
      $scope.addrs = null;

      fc.getMainAddresses({
        doNotVerify: true
      }, function(err, addrs) {
        if (err) {
          $log.warn(err);
          return;
        };
        var last10 = [],
          i = 0,
          e = addrs.pop();
        while (i++ < 10 && e) {
          e.path = e.path;
          last10.push(e);
          e = addrs.pop();
        }
        $scope.addrs = last10;
        $timeout(function() {
          $scope.$apply();
        });

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
        fc.getMainAddresses({
          doNotVerify: true
        }, function(err, addrs) {
          self.loading = false;
          if (err) {
            $log.warn(err);
            return;
          };

          var body = 'Byteball Wallet "' + $scope.walletName + '" Addresses\n  Only Main Addresses are  shown.\n\n';
          body += "\n";
          body += addrs.map(function(v) {
            return ('* ' + v.address + ' ' + v.path + ' ' + formatDate(v.createdOn));
          }).join("\n");

          window.plugins.socialsharing.shareViaEmail(
            body,
            'Byteball Addresses',
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
