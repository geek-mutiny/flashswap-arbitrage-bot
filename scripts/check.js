const hre = require("hardhat");
const config = require("./config/dexes.js");
const tokens = require("./config/tokens.js");
require("dotenv").config();

async function main() {
    const flashswap = await hre.ethers.getContractAt("Flashswap", process.env.FLASHSWAP_ADDRESS);
    const amount = ethers.utils.parseEther("1");

    console.log(tokens.busd, "->", tokens.bnb, amount.toString(), "/", config[0].name, "->", config[1].name);

    const result = await flashswap.check(
        tokens.busd,
        amount.toString(),
        tokens.bnb,
        config[0].router,
        config[1].router
    );

    console.log("result:", result[0], ",", result[1]);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
