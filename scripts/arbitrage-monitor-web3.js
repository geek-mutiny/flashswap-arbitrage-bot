const fs = require('fs');

const ethers = require('ethers');
const BridgeBsc = require('../build/contracts/BridgeBsc.json');

const web3Eth = new Web3('wss://eth-ropsten.alchemyapi.io/v2/aUwXzvyXAf_aYB1f1HSIK2wc7Ffg5wk2');
const web3Bsc = new Web3('wss://speedy-nodes-nyc.moralis.io/db75f020301a5eb8a74e2676/bsc/testnet/ws');
const adminPrivKey = fs.readFileSync("../.private").toString().trim();
const { address: admin } = web3Bsc.eth.accounts.wallet.add(adminPrivKey);

const bridgeEth = new web3Eth.eth.Contract(
    BridgeEth.abi,
    BridgeEth.networks['3'].address
);

const bridgeBsc = new web3Bsc.eth.Contract(
    BridgeBsc.abi,
    BridgeBsc.networks['97'].address
);

const formatLogMessage = (message) => {
    const formattedMessage = '[' + new Date().toISOString() + '] ' + message;
    console.log(formattedMessage);
    fs.appendFile(
        '/home/vl/www/crosschain/eth-bsc-bridge.log',
        formattedMessage + "\n",
        function (err) {
            //ignore
        }
    );
};

// event listener
bridgeEth.events.Transfer(
    { fromBlock: 'latest', step: 0 }
).on('data', async event => {
    try {
        const { from, to, amount, date, nonce, signature, step } = event.returnValues;

        if (step === '0') { // process transfer event on burn only
            formatLogMessage(`Processing transfer: from ${from}; to ${to}; amount ${amount}; date ${date}; nonce ${nonce}; signature ${signature}`);

            const tx = bridgeBsc.methods.mint(from, to, amount, nonce, signature);
            const [gasPrice, gasCost] = await Promise.all([
                web3Bsc.eth.getGasPrice(),
                tx.estimateGas({ from: admin }),
            ]);
            const data = tx.encodeABI();
            const txData = {
                from: admin,
                to: bridgeBsc.options.address,
                data,
                gas: gasCost,
                gasPrice
            };
            const receipt = await web3Bsc.eth.sendTransaction(txData);
            formatLogMessage(`Processed successfully. Transaction hash: ${receipt.transactionHash}`);
        } else {
            formatLogMessage('Mint detected. Ignore');
        }
    } catch (e) {
        console.log(e);
    }
});
