import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { TapiocaOptionLiquidityProvision__factory } from '../../typechain';
import { IDeployerVMAdd } from '../deployerVM';

export const buildTOLP = async (
    hre: HardhatRuntimeEnvironment,
    signerAddr: string,
): Promise<IDeployerVMAdd<TapiocaOptionLiquidityProvision__factory>> => ({
    contract: await hre.ethers.getContractFactory(
        'TapiocaOptionLiquidityProvision',
    ),
    deploymentName: 'TapiocaOptionLiquidityProvision',
    args: [
        // To be replaced by VM
        hre.ethers.constants.AddressZero,
        signerAddr,
    ],
    dependsOn: [{ argPosition: 0, deploymentName: 'YieldBoxMock' }],
});
