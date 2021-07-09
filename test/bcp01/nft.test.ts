import { expect } from "chai";
import { SIGNER_NUM, SIGNER_VERIFY_NUM } from "../../src/bcp01/nftProto";
import * as BN from "../../src/bn.js";
import * as bsv from "../../src/bsv";
import { CodeError, ErrCode } from "../../src/common/error";
import * as Utils from "../../src/common/utils";
import { API_NET, SensibleNFT } from "../../src/index";
import { dummyRabinKeypairs } from "../dummyRabin";
import { MockSatotxSigner } from "../MockSatotxSigner";
import { MockSensibleApi } from "../MockSensibleApi";
Utils.isNull(SIGNER_NUM);
const signerNum = SIGNER_NUM;
const signerVerifyNum = SIGNER_VERIFY_NUM;
const satotxSigners: MockSatotxSigner[] = [];
for (let i = 0; i < signerNum; i++) {
  let { p, q } = dummyRabinKeypairs[i];
  satotxSigners.push(
    new MockSatotxSigner(BN.fromString(p, 10), BN.fromString(q, 10))
  );
}
const signerSelecteds = new Array(signerNum)
  .fill(0)
  .map((v, idx) => idx)
  .sort((a, b) => Math.random() - 0.5)
  .slice(0, signerVerifyNum);
let wallets: {
  privateKey: bsv.PrivateKey;
  publicKey: bsv.PublicKey;
  address: bsv.Address;
}[] = [];
for (let i = 0; i < 4; i++) {
  let privateKey = new bsv.PrivateKey();
  wallets.push({
    privateKey,
    publicKey: privateKey.publicKey,
    address: privateKey.toAddress("mainnet"),
  });
}
function signSigHashList(sigHashList: Utils.SigHashInfo[]) {
  let sigList = sigHashList.map(
    ({ sighash, sighashType, address, inputIndex, isP2PKH }) => {
      let privateKey = wallets.find((v) => v.address.toString() == address)
        .privateKey;
      var sig = bsv.crypto.ECDSA.sign(
        Buffer.from(sighash, "hex"),
        privateKey,
        "little"
      )
        .set({
          nhashtype: sighashType,
        })
        .toString();
      return {
        sig,
        publicKey: privateKey.toPublicKey(),
      };
    }
  );
  return sigList;
}

let [FeePayer, CoffeeShop, Alice, Bob] = wallets;
// console.log(`
// FeePayer:   ${FeePayer.address.toString()}
// CoffeeShop: ${CoffeeShop.address.toString()}
// Alice:      ${Alice.address.toString()}
// Bob:        ${Bob.address.toString()}
// `);

let sensibleApi = new MockSensibleApi();
async function genDummyFeeUtxos(satoshis: number, count: number = 1) {
  let feeTx = new bsv.Transaction();
  let unitSatoshis = Math.ceil(satoshis / count);
  let satoshisArray = [];

  for (let i = 0; i < count; i++) {
    if (satoshis < unitSatoshis) {
      satoshisArray.push(satoshis);
    } else {
      satoshisArray.push(unitSatoshis);
    }
    satoshis -= unitSatoshis;
  }
  for (let i = 0; i < count; i++) {
    feeTx.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.buildPublicKeyHashOut(FeePayer.address),
        satoshis: satoshisArray[i],
      })
    );
  }
  let utxos = [];
  for (let i = 0; i < count; i++) {
    utxos.push({
      txId: feeTx.id,
      outputIndex: i,
      satoshis: satoshisArray[i],
      address: FeePayer.address.toString(),
      wif: FeePayer.privateKey.toWIF(),
    });
  }
  await sensibleApi.broadcast(feeTx.serialize(true));
  return utxos;
}
function cleanBsvUtxos() {
  sensibleApi.cleanBsvUtxos();
}
async function expectNftOwner(
  nft: SensibleNFT,
  codehash: string,
  genesis: string,
  address: bsv.Address,
  tokenIndex: string
) {
  let _res = await nft.getSummaryDetail(codehash, genesis, address.toString());

  expect(
    _res.find((v) => v.tokenIndex == tokenIndex),
    `${address} should has #${tokenIndex} NFT `
  ).to.not.be.null;
}
describe("BCP01-NonFungibleToken Test", () => {
  describe.only("basic test ", () => {
    let nft: SensibleNFT;
    let codehash: string;
    let genesis: string;
    before(async () => {
      const feeb = 0.5;
      const network = API_NET.MAIN;
      nft = new SensibleNFT({
        signers: [],
        signerSelecteds,
        feeb,
        network,
        purse: FeePayer.privateKey.toWIF(),
        debug: true,
        mockData: {
          satotxSigners,
          sensibleApi,
        },
      });
      sensibleApi.cleanCacheds();
    });

    afterEach(() => {});
    it("genesis should be ok", async () => {
      let utxos = await genDummyFeeUtxos(100000001);
      let _res = await nft.genesis({
        genesisWif: CoffeeShop.privateKey,
        totalSupply: "3",
      });
      // Utils.dumpTx(_res.tx);
      genesis = _res.genesis;
      codehash = _res.codehash;
    });
    it("issue should be ok", async () => {
      let _res1 = await nft.issue({
        codehash,
        genesis,
        genesisWif: CoffeeShop.privateKey.toString(),
        receiverAddress: CoffeeShop.address.toString(),
      });

      let _res2 = await nft.issue({
        codehash,
        genesis,
        genesisWif: CoffeeShop.privateKey.toString(),
        receiverAddress: CoffeeShop.address.toString(),
      });
    });
    it("transfer should be ok", async () => {
      let _res3 = await nft.transfer({
        codehash,
        genesis,
        senderWif: CoffeeShop.privateKey.toWIF(),
        receiverAddress: Alice.address.toString(),
        tokenIndex: "0",
      });
      // Utils.dumpTx(_res3.tx);

      expectNftOwner(nft, codehash, genesis, Alice.address, "0");
      expectNftOwner(nft, codehash, genesis, CoffeeShop.address, "1600");
    });
  });

  describe("unsign test ", () => {
    let nft: SensibleNFT;
    let codehash: string;
    let genesis: string;
    before(async () => {
      const feeb = 0.5;
      const network = API_NET.MAIN;
      nft = new SensibleNFT({
        signers: [],
        signerSelecteds,
        feeb,
        network,
        purse: FeePayer.privateKey.toWIF(),
        debug: true,
        mockData: {
          satotxSigners,
          sensibleApi,
        },
      });
      sensibleApi.cleanCacheds();
    });

    afterEach(() => {});
    it("unsign genesis should be ok", async () => {
      let utxos = await genDummyFeeUtxos(100000001);
      let { tx, sigHashList } = await nft.unsignGenesis({
        genesisPublicKey: CoffeeShop.publicKey,
        totalSupply: "3",
      });

      nft.sign(tx, sigHashList, signSigHashList(sigHashList));
      let _res = nft.getCodehashAndGensisByTx(tx);
      await sensibleApi.broadcast(tx.serialize(true));
      // Utils.dumpTx(_res.tx);
      genesis = _res.genesis;
      codehash = _res.codehash;
    });
    it("unsign issue should be ok", async () => {
      let { tx, sigHashList } = await nft.unsignIssue({
        codehash,
        genesis,
        genesisPublicKey: CoffeeShop.publicKey.toString(),
        receiverAddress: CoffeeShop.address.toString(),
      });
      nft.sign(tx, sigHashList, signSigHashList(sigHashList));
      await sensibleApi.broadcast(tx.serialize(true));
    });
    it("unsign transfer should be ok", async () => {
      let { tx, sigHashList } = await nft.unsignTransfer({
        codehash,
        genesis,
        senderPublicKey: CoffeeShop.publicKey,
        receiverAddress: Alice.address.toString(),
        tokenIndex: "0",
      });
      nft.sign(tx, sigHashList, signSigHashList(sigHashList));
      await sensibleApi.broadcast(tx.serialize(true));

      expectNftOwner(nft, codehash, genesis, Alice.address, "0");
      expectNftOwner(nft, codehash, genesis, CoffeeShop.address, "1600");
    });
  });

  describe("estimate fee test ", () => {
    let nft: SensibleNFT;
    let codehash: string;
    let genesis: string;
    before(async () => {
      const feeb = 0.5;
      const network = API_NET.MAIN;
      nft = new SensibleNFT({
        signers: [],
        signerSelecteds,
        feeb,
        network,
        purse: FeePayer.privateKey.toWIF(),
        debug: true,
        mockData: {
          satotxSigners,
          sensibleApi,
        },
      });
      sensibleApi.cleanCacheds();
    });

    beforeEach(async () => {});
    afterEach(() => {});

    it("estimate genesis fee should be ok", async () => {
      const opreturnData = "11111111";
      let estimateFee = await nft.getGenesisEstimateFee({
        opreturnData,
        utxoMaxCount: 10,
      });
      let utxos = await genDummyFeeUtxos(estimateFee, 10);
      let _res = await nft.genesis({
        genesisWif: CoffeeShop.privateKey,
        totalSupply: "3",
        opreturnData,
        utxos,
      });
      // Utils.dumpTx(_res.tx);
      genesis = _res.genesis;
      codehash = _res.codehash;
    });
    it("estimate issue fee should be ok", async () => {
      const opreturnData = "11111111";
      cleanBsvUtxos();
      let estimateFee = await nft.getIssueEstimateFee({
        genesis,
        genesisPublicKey: CoffeeShop.publicKey,
        opreturnData,
        utxoMaxCount: 10,
      });
      let utxos = await genDummyFeeUtxos(estimateFee, 10);
      let _res1 = await nft.issue({
        codehash,
        genesis,
        genesisWif: CoffeeShop.privateKey.toString(),
        receiverAddress: CoffeeShop.address.toString(),
        opreturnData,
        utxos,
      });
      // Utils.dumpTx(_res1.tx);
    });
    it("estimate transfer fee should be ok", async () => {
      cleanBsvUtxos();
      const opreturnData = "sss";
      let estimateFee = await nft.getTransferEstimateFee({
        genesis,
        codehash,
        tokenIndex: "0",
        senderPublicKey: CoffeeShop.publicKey,
        opreturnData,
        utxoMaxCount: 10,
      });
      let utxos = await genDummyFeeUtxos(estimateFee, 10);
      let _res3 = await nft.transfer({
        codehash,
        genesis,
        senderWif: CoffeeShop.privateKey.toWIF(),
        receiverAddress: Alice.address.toString(),
        tokenIndex: "0",
        utxos,
      });
      // Utils.dumpTx(_res3.tx);

      expectNftOwner(nft, codehash, genesis, Alice.address, "0");
      expectNftOwner(nft, codehash, genesis, CoffeeShop.address, "1600");
    });
  });
  describe("reach totalSupply test ", () => {
    let nft: SensibleNFT;
    let codehash: string;
    let genesis: string;
    before(async () => {
      const feeb = 0.5;
      const network = API_NET.MAIN;
      nft = new SensibleNFT({
        signers: [],
        signerSelecteds,
        feeb,
        network,
        purse: FeePayer.privateKey.toWIF(),
        debug: true,
        mockData: {
          satotxSigners,
          sensibleApi,
        },
      });
      sensibleApi.cleanCacheds();
    });

    afterEach(() => {});
    it("genesis totalSupply 1 be ok", async () => {
      let utxos = await genDummyFeeUtxos(100000001);
      let _res = await nft.genesis({
        genesisWif: CoffeeShop.privateKey,
        totalSupply: "1",
      });
      // Utils.dumpTx(_res.tx);
      genesis = _res.genesis;
      codehash = _res.codehash;
    });

    it("issue #0 NFT should be ok", async () => {
      let _res1 = await nft.issue({
        codehash,
        genesis,
        genesisWif: CoffeeShop.privateKey.toString(),
        receiverAddress: CoffeeShop.address.toString(),
      });
    });

    it("issue #1 NFT should fail for reaching the totalSupply", async () => {
      try {
        let _res1 = await nft.issue({
          codehash,
          genesis,
          genesisWif: CoffeeShop.privateKey.toString(),
          receiverAddress: CoffeeShop.address.toString(),
        });
      } catch (e) {
        let error = e as CodeError;
        expect(
          error.code == ErrCode.EC_FIXED_TOKEN_SUPPLY,
          "it should reach the totalSupply"
        ).to.be.true;
      }
    });
  });
});
