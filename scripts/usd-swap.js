const hre = require("hardhat");
const config = require("./config/dexes.js");
const tokens = require("./config/tokens.js");
require("dotenv").config();

async function main() {
    const flashswap = await hre.ethers.getContractAt("Flashswap", process.env.FLASHSWAP_ADDRESS);

    const result = await flashswap.swapToUsd(
        tokens.bnb,
        tokens.busd,
        config[0].router,
        {
            gasLimit: process.env.GAS_LIMIT
        }
    );

    console.log(result);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
