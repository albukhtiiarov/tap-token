import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20Mock, LZEndpointMock, VeTapOFT, TapOFT } from '../../typechain';

import { deployLZEndpointMock, deployTapiocaOFT, deployveTapiocaNFT, BN, time_travel } from '../test.utils';

describe('veTapiocaOFT', () => {
    let signer: SignerWithAddress;
    let signer2: SignerWithAddress;
    let signer3: SignerWithAddress;
    let LZEndpointMock: LZEndpointMock;
    let erc20Mock: ERC20Mock;
    let tapiocaOFT: TapOFT;
    let veTapiocaOFT: VeTapOFT;

    const veTapiocaName = 'veTapioca Token';
    const veTapiocaSymbol = 'veTAP';
    const veTapiocaVersion = '1';
    const DAY: number = 86400;
    const HALF_UNLOCK_TIME: number = 2 * 365 * DAY; //half of max time
    const UNLOCK_TIME: number = 2 * HALF_UNLOCK_TIME; //max time

    beforeEach(async () => {
        signer = (await ethers.getSigners())[0];
        signer2 = (await ethers.getSigners())[1];
        signer3 = (await ethers.getSigners())[2];

        LZEndpointMock = (await deployLZEndpointMock(0)) as LZEndpointMock;
        erc20Mock = await (await hre.ethers.getContractFactory('ERC20Mock')).deploy(ethers.BigNumber.from((1e18).toString()).mul(1e9));
        tapiocaOFT = (await deployTapiocaOFT(LZEndpointMock.address, signer.address)) as TapOFT;
        veTapiocaOFT = (await deployveTapiocaNFT(tapiocaOFT.address, veTapiocaName, veTapiocaSymbol, veTapiocaVersion)) as VeTapOFT;
    });

    it('should do nothing', async () => {
        expect(1).to.eq(1);
    });

    it('should check initial state', async () => {
        const savedAdmin = await veTapiocaOFT.admin();
        expect(savedAdmin.toLowerCase()).to.eq(signer.address.toLowerCase());

        const savedToken = await veTapiocaOFT.token();
        expect(savedToken.toLowerCase()).to.eq(tapiocaOFT.address.toLowerCase());

        const savedController = await veTapiocaOFT.controller();
        expect(savedController.toLowerCase()).to.eq(signer.address.toLowerCase());

        const tokenDecimals = await tapiocaOFT.decimals();
        const savedDecimals = await veTapiocaOFT.decimals();
        expect(savedDecimals).to.eq(tokenDecimals);

        const savedName = await veTapiocaOFT.name();
        expect(savedName).to.eq(veTapiocaName);

        const savedSymbol = await veTapiocaOFT.symbol();
        expect(savedSymbol).to.eq(veTapiocaSymbol);

        const savedVersion = await veTapiocaOFT.version();
        expect(savedVersion).to.eq(veTapiocaVersion);

        const transferedEnabled = await veTapiocaOFT.transfersEnabled();
        expect(transferedEnabled).to.be.true;
    });

    it('should whitelist a contract', async () => {
        const isWhitelisted = await veTapiocaOFT.whitelisted_contracts(signer2.address);
        expect(isWhitelisted).to.be.false;

        await veTapiocaOFT.whitelist_contract(signer2.address);

        const isNowWhitelisted = await veTapiocaOFT.whitelisted_contracts(signer2.address);
        expect(isNowWhitelisted).to.be.true;

        await veTapiocaOFT.remove_whitelisted_contract(signer2.address);
        const finalWhitelistStatus = await veTapiocaOFT.whitelisted_contracts(signer2.address);
        expect(finalWhitelistStatus).to.be.false;
    });

    it('should change admin', async () => {
        const savedAdmin = await veTapiocaOFT.admin();
        expect(savedAdmin.toLowerCase()).to.eq(signer.address.toLowerCase());

        const savedFutureAdmin = await veTapiocaOFT.future_admin();
        expect(savedFutureAdmin.toLowerCase()).to.eq(ethers.constants.AddressZero.toLowerCase());
        await veTapiocaOFT.commit_transfer_ownership(signer2.address);

        const newFutureAdmin = await veTapiocaOFT.future_admin();
        expect(newFutureAdmin.toLowerCase()).to.eq(signer2.address.toLowerCase());

        const stillTheSameAdmin = await veTapiocaOFT.admin();
        expect(stillTheSameAdmin.toLowerCase()).to.eq(signer.address.toLowerCase());

        await veTapiocaOFT.apply_transfer_ownership();

        const finalAdmin = await veTapiocaOFT.admin();
        expect(finalAdmin.toLowerCase()).to.eq(signer2.address.toLowerCase());
    });

    it('should return nothing for non-participant', async () => {
        const lastSlope = await veTapiocaOFT.get_last_user_slope(signer.address);
        expect(lastSlope).to.eq(0);

        const lastTimestmap = await veTapiocaOFT.user_point_history__ts(signer.address, 0);
        expect(lastTimestmap).to.eq(0);

        // locked__end
        const lockedEnd = await veTapiocaOFT.locked__end(signer.address);
        expect(lockedEnd).to.eq(0);

        const erc20 = await ethers.getContractAt('IOFT', veTapiocaOFT.address);

        const balanceOf = await erc20.balanceOf(signer.address);
        expect(balanceOf).to.eq(0);

        const balanceOfAt = await veTapiocaOFT.balanceOfAt(signer.address, 1);
        expect(balanceOfAt).to.eq(0);

        const totalSupply = await erc20.totalSupply();
        expect(totalSupply).to.eq(0);

        const totalSupplyAt = await veTapiocaOFT.totalSupplyAt(1);
        expect(totalSupplyAt).to.eq(0);
    });

    it('should not be able to deposit if no lock was created before', async () => {
        await expect(veTapiocaOFT.connect(signer).deposit_for(signer.address, 0)).to.be.revertedWith('value not valid');

        await expect(veTapiocaOFT.connect(signer).deposit_for(signer.address, ethers.utils.parseEther('10'))).to.be.revertedWith(
            'locked amount not valid',
        );
    });

    it('should not be able to create lock with invalid params', async () => {
        await expect(veTapiocaOFT.connect(signer).create_lock(0, 0)).to.be.revertedWith;
        await expect(veTapiocaOFT.connect(signer).create_lock(ethers.utils.parseEther('10'), 0)).to.be.reverted;
        await expect(veTapiocaOFT.connect(signer).create_lock(ethers.utils.parseEther('10'), 99999999999999)).to.be.reverted;
    });

    it('should be able to create a lock with TAP', async () => {
        const amountToLock = BN(10000).mul((1e18).toString());
        const minLockedAmount = BN(9000).mul((1e18).toString());

        const latestBlock = await ethers.provider.getBlock('latest');

        await tapiocaOFT.connect(signer).approve(veTapiocaOFT.address, amountToLock);
        await veTapiocaOFT.connect(signer).create_lock(amountToLock, latestBlock.timestamp + UNLOCK_TIME);

        const erc20 = await ethers.getContractAt('IOFT', veTapiocaOFT.address);

        const signerVotingBalance = await erc20.balanceOf(signer.address);
        expect(signerVotingBalance.gt(minLockedAmount)).to.be.true;
    });

    it('should be able to create a lock and voting power should decrease over time', async () => {
        const amountToLock = BN(10000).mul((1e18).toString());
        const latestBlock = await ethers.provider.getBlock('latest');
        const erc20 = await ethers.getContractAt('IOFT', veTapiocaOFT.address);

        const signerBalanceOfTAP = await tapiocaOFT.balanceOf(signer.address);
        expect(signerBalanceOfTAP.gt(0)).to.be.true;

        //lock from signer2
        await expect(veTapiocaOFT.connect(signer2).create_lock(amountToLock, latestBlock.timestamp + UNLOCK_TIME)).to.be.reverted; // should be reverted as signer2 does not have any tokens yet

        await tapiocaOFT.connect(signer).transfer(signer2.address, amountToLock);
        const signer2BalanceOfTAP = await tapiocaOFT.balanceOf(signer2.address);
        expect(signer2BalanceOfTAP.eq(amountToLock)).to.be.true;

        await expect(veTapiocaOFT.connect(signer2).create_lock(amountToLock, latestBlock.timestamp + UNLOCK_TIME)).to.be.reverted; //should still revert as there is no approval for spending

        await tapiocaOFT.connect(signer2).approve(veTapiocaOFT.address, amountToLock);
        await veTapiocaOFT.connect(signer2).create_lock(amountToLock, latestBlock.timestamp + UNLOCK_TIME);
        const signer2VeTapBalance = await erc20.balanceOf(signer2.address);

        //time tranvel 10 days
        time_travel(10 * DAY);

        //lock from signer
        await tapiocaOFT.connect(signer).approve(veTapiocaOFT.address, amountToLock);
        await veTapiocaOFT.connect(signer).create_lock(amountToLock, latestBlock.timestamp + HALF_UNLOCK_TIME);
        const signerVeTapValance = await erc20.balanceOf(signer.address);

        expect(signer2VeTapBalance.gt(signerVeTapValance)).to.be.true;

        const signerLockedEnd = await veTapiocaOFT.locked__end(signer.address);
        const signer2LockedEnd = await veTapiocaOFT.locked__end(signer2.address);

        expect(signer2LockedEnd.gt(signerLockedEnd)).to.be.true;

        //time tranvel 100 days
        time_travel(100 * DAY);

        await veTapiocaOFT.checkpoint();
        const signerVotingPower = await veTapiocaOFT.get_last_user_slope(signer.address);
        const signer2VotingPower = await veTapiocaOFT.get_last_user_slope(signer2.address);
        const finalSignerVeTapBalance = await erc20.balanceOf(signer.address);
        expect(signerVotingPower.gt(0)).to.be.true;
        expect(signer2VotingPower.gt(0)).to.be.true;
        expect(signerVeTapValance.gt(finalSignerVeTapBalance)).to.be.true;
    });

    it('should increase unlock time for position', async () => {
        const amountToLock = BN(10000).mul((1e18).toString());
        const latestBlock = await ethers.provider.getBlock('latest');
        const erc20 = await ethers.getContractAt('IOFT', veTapiocaOFT.address);

        await tapiocaOFT.connect(signer).approve(veTapiocaOFT.address, amountToLock);
        await veTapiocaOFT.connect(signer).create_lock(amountToLock, latestBlock.timestamp + HALF_UNLOCK_TIME);

        const signerVeTapBalance = await erc20.balanceOf(signer.address);
        const signerLockedEnd = await veTapiocaOFT.locked__end(signer.address);

        // increase_unlock_time
        await veTapiocaOFT.connect(signer).increase_unlock_time(latestBlock.timestamp + UNLOCK_TIME);
        const signerNewLockedEnd = await veTapiocaOFT.locked__end(signer.address);
        expect(signerNewLockedEnd.gt(signerLockedEnd)).to.be.true;

        const signerVeTapBalanceAfterUnlockTimeIncrease = await erc20.balanceOf(signer.address);
        expect(signerVeTapBalanceAfterUnlockTimeIncrease.gt(signerVeTapBalance)).to.be.true;
    });

    it('should increase amount for position', async () => {
        const amountToLock = BN(10000).mul((1e18).toString());
        const latestBlock = await ethers.provider.getBlock('latest');
        const erc20 = await ethers.getContractAt('IOFT', veTapiocaOFT.address);

        await tapiocaOFT.connect(signer).approve(veTapiocaOFT.address, amountToLock);
        await veTapiocaOFT.connect(signer).create_lock(amountToLock, latestBlock.timestamp + HALF_UNLOCK_TIME);
        const signerVeTapBalance = await erc20.balanceOf(signer.address);

        // increase_amount
        await tapiocaOFT.connect(signer).approve(veTapiocaOFT.address, amountToLock);
        await veTapiocaOFT.connect(signer).increase_amount(amountToLock);
        const signerVeTapBalanceAfterAmountIncrease = await erc20.balanceOf(signer.address);

        expect(signerVeTapBalanceAfterAmountIncrease.gt(signerVeTapBalance)).to.be.true;
    });

    it('should create a lock for someone else', async () => {
        const amountToLock = BN(10000).mul((1e18).toString());
        const latestBlock = await ethers.provider.getBlock('latest');
        const erc20 = await ethers.getContractAt('IOFT', veTapiocaOFT.address);

        await tapiocaOFT.connect(signer).approve(veTapiocaOFT.address, amountToLock);
        await veTapiocaOFT.connect(signer).create_lock_for(signer2.address, amountToLock, latestBlock.timestamp + UNLOCK_TIME);

        const signer2VeTapBalance = await erc20.balanceOf(signer2.address);
        expect(signer2VeTapBalance.gt(0)).to.be.true;

        const signerVeTokenBalance = await erc20.balanceOf(signer.address);
        expect(signerVeTokenBalance.eq(0)).to.be.true;
    });

    it('should be able to force withdraw with a penaly', async () => {
        const amountToLock = BN(10000).mul((1e18).toString());
        const finalPossibleAmount = BN(2500).mul((1e18).toString());
        const latestBlock = await ethers.provider.getBlock('latest');
        const erc20 = await ethers.getContractAt('IOFT', veTapiocaOFT.address);

        await tapiocaOFT.connect(signer).transfer(signer2.address, amountToLock);
        await tapiocaOFT.connect(signer2).approve(veTapiocaOFT.address, amountToLock);
        await veTapiocaOFT.connect(signer2).create_lock(amountToLock, latestBlock.timestamp + UNLOCK_TIME);

        const signer2VeTapBalance = await erc20.balanceOf(signer2.address);
        expect(signer2VeTapBalance.gt(0)).to.be.true;

        await expect(veTapiocaOFT.connect(signer3).force_withdraw()).to.be.reverted; //not a valid user
        await veTapiocaOFT.connect(signer2).force_withdraw();

        const signer2FinalTapBalance = await tapiocaOFT.balanceOf(signer2.address);
        expect(signer2FinalTapBalance.eq(finalPossibleAmount)).to.be.true;
    });

    it('should not be able to withdraw', async () => {
        const amountToLock = BN(10000).mul((1e18).toString());
        const finalPossibleAmount = BN(2500).mul((1e18).toString());
        const latestBlock = await ethers.provider.getBlock('latest');
        const erc20 = await ethers.getContractAt('IOFT', veTapiocaOFT.address);

        await tapiocaOFT.connect(signer).approve(veTapiocaOFT.address, amountToLock);
        await veTapiocaOFT.connect(signer).create_lock(amountToLock, latestBlock.timestamp + UNLOCK_TIME);

        const signerVeTapBalance = await erc20.balanceOf(signer.address);

        //should revert
        await expect(veTapiocaOFT.connect(signer).withdraw()).to.be.reverted;

        //make sure the unlock time has passed
        time_travel(10 * UNLOCK_TIME);

        await veTapiocaOFT.connect(signer).withdraw();

        const signerFinalVeTapBalance = await erc20.balanceOf(signer.address);

        expect(signerFinalVeTapBalance.lt(signerVeTapBalance)).to.be.true;
        expect(signerFinalVeTapBalance.eq(0)).to.be.true;
    });
});
