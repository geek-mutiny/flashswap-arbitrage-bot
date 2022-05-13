const hre = require("hardhat");

async function main() {
  const Flashswap = await hre.ethers.getContractFactory("Flashswap");
  const flashswap = await Flashswap.deploy();

  await flashswap.deployed();

  console.log("Flashswap deployed to:", flashswap.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
