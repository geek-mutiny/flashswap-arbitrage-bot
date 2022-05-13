const ethers = require("ethers");
const { Multicall } = require('ethereum-multicall');
const config = require("./config/dexes.js");
const tokens = require("./config/tokens.js");
require("dotenv").config();

let provider;
let signer;
let multicall;

const routerAddresses = {};
const pairContracts = {};
const pairs = {};

const factoryAbi = {};
const routerAbi = {};
const pairAbi = {};

const usdPrices = {
    [tokens.busd.toLowerCase()]: {}
};

const amountToSwapPercentage = 15; // 10%
const percentageThreshold = 1; // 1%
const usdProfitThreshold = "1"; // $1

const getFactoryAbi = function (dex) {
    return require("./abi/" + dex + "Factory.json");
};

const getRouterAbi = function (dex) {
    return require("./abi/" + dex + "Router.json");
};

const getPairAbi = function (dex) {
    return require("./abi/" + dex + "Pair.json");
};

const parseConfig = async function () {
    const params = [];

    config.forEach(function (dex) {
        const processedTokens = [];
        const calls = [];

        factoryAbi[dex.name] = getFactoryAbi(dex.name);
        routerAbi[dex.name] = getRouterAbi(dex.name);
        pairAbi[dex.name] = getPairAbi(dex.name);

        routerAddresses[dex.name] = dex.router;

        Object.entries(tokens).forEach(function (token0) {
            const [tokenName0, tokenAddress0] = token0;

            processedTokens.push(tokenName0);

            Object.entries(tokens).forEach(function (token1) {
                const [tokenName1, tokenAddress1] = token1;

                if (!processedTokens.includes(tokenName1)) {
                    calls.push({
                        reference: tokenName0 + "-" + tokenName1,
                        methodName: 'getPair',
                        methodParameters: [tokenAddress0, tokenAddress1]
                    });
                }
            });
        });

        params.push({
            reference: dex.name,
            contractAddress: dex.factory,
            abi: factoryAbi[dex.name],
            calls: calls,
        });
    });

    const result = await multicall.call(params);

    delete params; // @todo

    const pairsParams = [];

    Object.entries(result.results).forEach(function (dexResults) {
        const [dexName, dexPairs] = dexResults;

        dexPairs.callsReturnContext.forEach(function (dexPair) {
            const pairAddress = dexPair.returnValues[0];
            const pairName = dexPair.reference;

            if (pairAddress != ethers.constants.AddressZero) {
                console.log(dexName, pairName, pairAddress);

                if (typeof pairContracts[pairName] === 'undefined') {
                    pairContracts[pairName] = {};
                }

                pairContracts[pairName][dexName] = new ethers.Contract(pairAddress, pairAbi[dexName], signer);

                pairsParams.push({
                    reference: pairName + "_" + dexName,
                    contractAddress: pairAddress,
                    abi: pairAbi[dexName],
                    calls: [
                        {
                            reference: 'reserves',
                            methodName: 'getReserves',
                            methodParameters: []
                        },
                        {
                            reference: 'token0',
                            methodName: 'token0',
                            methodParameters: []
                        },
                        {
                            reference: 'token1',
                            methodName: 'token1',
                            methodParameters: []
                        },
                    ],
                });
            }
        });
    });

    delete result; // @todo

    const pairsResult = await multicall.call(pairsParams);

    delete pairsParams; // @todo

    Object.entries(pairsResult.results).forEach(function (pairResults) {
        const [pairDexName, pairData] = pairResults;
        const pairName = pairDexName.split("_")[0];
        const dexName = pairDexName.split("_")[1];

        if (typeof pairs[pairName] === 'undefined') {
            pairs[pairName] = {};
        }

        pairs[pairName][dexName] = [
            {
                token: pairData.callsReturnContext[1].returnValues[0],
                reserve: pairData.callsReturnContext[0].returnValues[0]
            },
            {
                token: pairData.callsReturnContext[2].returnValues[0],
                reserve: pairData.callsReturnContext[0].returnValues[1],
            }
        ];
    });

    delete pairsResult; // @todo
};

const syncUsdPrices = async function () {
    const params = [];
    // console.log('syncUsdPrices 1');
    Object.entries(tokens).forEach(function (token) {
        const [tokenName, tokenAddress] = token;


        Object.entries(routerAddresses).forEach(function (router) {
            const [dexName, routerAddress] = router;

            if (tokenName !== "busd") {
                params.push({
                    reference: tokenAddress + "_" + dexName,
                    contractAddress: routerAddress,
                    abi: routerAbi[dexName],
                    calls: [{
                        reference: 'price',
                        methodName: 'getAmountsOut',
                        methodParameters: [
                            ethers.utils.parseEther("1"),
                            [tokenAddress, tokens.busd]
                        ]
                    }]
                });
            } else {
                usdPrices[tokenAddress.toLowerCase()][dexName] = ethers.utils.parseEther("1");
            }
        });

    });
    // console.log('syncUsdPrices 2');
    const result = await multicall.call(params);
    // console.log('syncUsdPrices 3');
    delete params; // @todo

    Object.entries(result.results).forEach(function (data) {
        const reference = data[0];
        const price = data[1].callsReturnContext[0].returnValues[1];
        const tokenAddress = reference.split("_")[0];
        const dexName = reference.split("_")[1];

        if (typeof usdPrices[tokenAddress.toLowerCase()] === 'undefined') {
            usdPrices[tokenAddress.toLowerCase()] = {};
        }

        usdPrices[tokenAddress.toLowerCase()][dexName] = typeof price !== 'undefined' ? price : ethers.constants.Zero;
    });
    // console.log('syncUsdPrices 4');
    delete result; // @todo
};

const getMostProfitable = async function (pairName, baseDexName) {
    const startTime = Date.now();
    // console.log('getMostProfitable 1');
    const baseParams = [];
    const params = [];
    const dexes = {};
    const basePrices = {};
    const baseToken0 = pairs[pairName][baseDexName][0].token;
    const baseToken1 = pairs[pairName][baseDexName][1].token;
    const baseReserve0 = pairs[pairName][baseDexName][0].reserve;
    const baseReserve1 = pairs[pairName][baseDexName][1].reserve;
    const baseAmount0 = baseReserve0.mul(amountToSwapPercentage).div(100);
    const baseAmount1 = baseReserve1.mul(amountToSwapPercentage).div(100);

    Object.entries(routerAddresses).forEach(function (router) {
        const [dexName, routerAddress] = router;

        if (dexName !== baseDexName && typeof pairs[pairName][dexName] !== 'undefined') {
            let amount0;
            let amount1;
            let reserve0;
            let reserve1;

            if (baseToken0 === pairs[pairName][dexName][0].token) {
                reserve0 = ethers.BigNumber.from(pairs[pairName][dexName][0].reserve);
                reserve1 = ethers.BigNumber.from(pairs[pairName][dexName][1].reserve);
            } else {
                reserve0 = ethers.BigNumber.from(pairs[pairName][dexName][1].reserve);
                reserve1 = ethers.BigNumber.from(pairs[pairName][dexName][0].reserve);
            }

            if (baseReserve0.gt(reserve0) || baseReserve1.gt(reserve1)) {
                amount0 = reserve0.mul(amountToSwapPercentage).div(100);
                amount1 = reserve1.mul(amountToSwapPercentage).div(100);
            } else {
                amount0 = baseAmount0;
                amount1 = baseAmount1;
            }

            if (amount0.gt(0) && amount1.gt(0)) {
                baseParams.push({
                    reference: amount0.toString() + "-" + amount1.toString(),
                    contractAddress: routerAddresses[baseDexName],
                    abi: routerAbi[baseDexName],
                    calls: getCalls(
                        baseToken0,
                        baseToken1,
                        amount0,
                        amount1
                    )
                });

                dexes[dexName] = {
                    amount0: amount0,
                    amount1: amount1,
                    params: {
                        reference: dexName,
                        contractAddress: routerAddress,
                        abi: routerAbi[dexName],
                        calls: []
                    }
                };
            }
        }
    });
    // console.log('getMostProfitable 2');
    const baseResult = await multicall.call(baseParams);
    // console.log('getMostProfitable 3');
    delete baseParams; // @todo

    Object.entries(baseResult.results).forEach(function (value) {
        const reference = value[0];
        const result = value[1];

        basePrices[reference] = {
            "price0": result.callsReturnContext[0].returnValues[1],
            "price1": result.callsReturnContext[1].returnValues[1],
            // "price0": result.callsReturnContext[0].returnValues.length > 0 ? result.callsReturnContext[0].returnValues[1] : ethers.BigNumber.from(0),
            // "price1": result.callsReturnContext[1].returnValues.length > 0 ? result.callsReturnContext[1].returnValues[1] : ethers.BigNumber.from(0),
        };
    });

    delete baseResult; // @todo
    // console.log('getMostProfitable 4');
    Object.entries(dexes).forEach(function (value) {
        const dex = value[1];
        const reference = dex.amount0.toString() + "-" + dex.amount1.toString();
        const dexParams = dex.params;

        dexParams.calls = getCalls(
            baseToken0,
            baseToken1,
            basePrices[reference].price0,
            basePrices[reference].price1
        );

        params.push(dexParams);
    });
    // console.log('getMostProfitable 5');
    const result = await multicall.call(params);
    // console.log('getMostProfitable 6');
    delete params; // @todo

    Object.entries(result.results).forEach(function (value) {
        const [dexName, result] = value;

        if (result.callsReturnContext[0].returnValues.length > 0
            && result.callsReturnContext[1].returnValues.length > 0) {
            const dexAmount0 = dexes[dexName].amount0;
            const dexAmount1 = dexes[dexName].amount1;
            const price0 = ethers.BigNumber.from(result.callsReturnContext[0].returnValues[1]);
            const price1 = ethers.BigNumber.from(result.callsReturnContext[1].returnValues[1]);
            const percentage0 = (price0.sub(dexAmount0)).mul(100).div(dexAmount0);
            const percentage1 = (price1.sub(dexAmount1)).mul(100).div(dexAmount1);
            const usdProfit0 = (price0.sub(dexAmount0)).mul(usdPrices[baseToken0.toLowerCase()][dexName]).div(ethers.utils.parseEther("1"));
            const usdProfit1 = (price1.sub(dexAmount1)).mul(usdPrices[baseToken1.toLowerCase()][dexName]).div(ethers.utils.parseEther("1"));

            const endTime = (Date.now() - startTime) / 1000;
            if (usdProfit0.gte(ethers.utils.parseEther(usdProfitThreshold))) {
                // if (percentage0.gte(percentageThreshold)) {
                // const profitMark = usdProfit0.gte(ethers.utils.parseEther(usdProfitThreshold)) ? "/ !!!!!!!!!!!!!" : "";

                console.log(
                    '[' + new Date().toISOString() + ']', endTime,
                    "/ Diff (0)", pairName, "/", baseToken0, "/", baseDexName, "->", dexName,
                    "/", ethers.utils.formatEther(dexAmount0), "->", ethers.utils.formatEther(price0),
                    "/ ", "$" + ethers.utils.formatEther(usdProfit0),
                    "/", percentage0.toString() + "%"//, profitMark
                );
            }

            if (usdProfit1.gte(ethers.utils.parseEther(usdProfitThreshold))) {
                // if (percentage1.gte(percentageThreshold)) {
                // const profitMark = usdProfit1.gte(ethers.utils.parseEther(usdProfitThreshold)) ? "/ !!!!!!!!!!!!!" : "";

                console.log(
                    '[' + new Date().toISOString() + ']', endTime,
                    "/ Diff (1)", pairName, "/", baseToken1, "/", baseDexName, "->", dexName,
                    "/", ethers.utils.formatEther(dexAmount1), "->", ethers.utils.formatEther(price1),
                    "/", "$" + ethers.utils.formatEther(usdProfit1),
                    "/", percentage1.toString() + "%"//, profitMark
                );
            }
        }
    });
    // console.log('getMostProfitable 7');
    delete result; // @todo
};

const getCalls = function (token0, token1, amount0, amount1) {
    return [
        {
            reference: 'price1',
            methodName: 'getAmountsOut',
            methodParameters: [
                amount1,
                [token1, token0]
            ]
        },
        {
            reference: 'price0',
            methodName: 'getAmountsOut',
            methodParameters: [
                amount0,
                [token0, token1]
            ]
        },
    ];
};

async function main() {
    provider = new ethers.providers.WebSocketProvider(process.env.BSC_NETWORK_URL);
    signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    multicall = new Multicall({ ethersProvider: provider, tryAggregate: true });

    await parseConfig();

    await syncUsdPrices();

    console.log(usdPrices);

    setInterval(function () {
        syncUsdPrices();
    }, 3000);

    // Listen for price updates
    Object.entries(pairContracts).forEach(async function (pair) {
        const pairName = pair[0];

        Object.entries(pair[1]).forEach(async function (pairContract) {
            const dexName = pairContract[0];
            console.log("Listen", dexName, pairName);

            pairContract[1].on("Sync", async (reserve0, reserve1) => {
                pairs[pairName][dexName][0].reserve = reserve0;
                pairs[pairName][dexName][1].reserve = reserve1;

                await getMostProfitable(pairName, dexName);
            });
        });
    });
}

main()
    // .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
