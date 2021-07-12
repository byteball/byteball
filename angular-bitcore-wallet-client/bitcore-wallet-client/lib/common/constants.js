'use strict';

var Constants = {};

Constants.DERIVATION_STRATEGIES = {
  BIP44: 'BIP44',
  BIP48: 'BIP48',
};




Constants.UNITS = {
  /*btc: {
    toSatoshis: 100000000,
    maxDecimals: 6,
    minDecimals: 2,
  },
  bit: {
    toSatoshis: 100,
    maxDecimals: 0,
    minDecimals: 0,
  },*/
  one: {
    value: 1,
    maxDecimals: 0,
    minDecimals: 0,
  },
  kilo: {
    value: 1000,
    maxDecimals: 0,
    minDecimals: 0,
  },
  mega: {
    value: 1000000,
    maxDecimals: 0,
    minDecimals: 0,
  },
  obyte: {
    value: 100000000,
    maxDecimals: 0,
    minDecimals: 0,
  },
  giga: {
    value: 1000000000,
    maxDecimals: 0,
    minDecimals: 0,
  }
};

module.exports = Constants;
