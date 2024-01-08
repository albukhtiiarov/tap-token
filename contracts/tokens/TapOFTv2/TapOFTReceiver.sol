// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.22;

// LZ
import {IOAppComposer} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppComposer.sol";
import {OFTMsgCodec} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/libs/OFTMsgCodec.sol";
import {Origin} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";
import {OFT} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFT.sol";

// Tapioca
import {LockTwTapPositionMsg, ERC20PermitApprovalMsg} from "./ITapOFTv2.sol";
import {TapOFTMsgCoder} from "./TapOFTMsgCoder.sol";
import {BaseTapOFTv2} from "./BaseTapOFTv2.sol";

// TODO remove console
import "forge-std/console.sol";

/*

__/\\\\\\\\\\\\\\\_____/\\\\\\\\\_____/\\\\\\\\\\\\\____/\\\\\\\\\\\_______/\\\\\_____________/\\\\\\\\\_____/\\\\\\\\\____        
 _\///////\\\/////____/\\\\\\\\\\\\\__\/\\\/////////\\\_\/////\\\///______/\\\///\\\________/\\\////////____/\\\\\\\\\\\\\__       
  _______\/\\\________/\\\/////////\\\_\/\\\_______\/\\\_____\/\\\_______/\\\/__\///\\\____/\\\/____________/\\\/////////\\\_      
   _______\/\\\_______\/\\\_______\/\\\_\/\\\\\\\\\\\\\/______\/\\\______/\\\______\//\\\__/\\\_____________\/\\\_______\/\\\_     
    _______\/\\\_______\/\\\\\\\\\\\\\\\_\/\\\/////////________\/\\\_____\/\\\_______\/\\\_\/\\\_____________\/\\\\\\\\\\\\\\\_    
     _______\/\\\_______\/\\\/////////\\\_\/\\\_________________\/\\\_____\//\\\______/\\\__\//\\\____________\/\\\/////////\\\_   
      _______\/\\\_______\/\\\_______\/\\\_\/\\\_________________\/\\\______\///\\\__/\\\_____\///\\\__________\/\\\_______\/\\\_  
       _______\/\\\_______\/\\\_______\/\\\_\/\\\______________/\\\\\\\\\\\____\///\\\\\/________\////\\\\\\\\\_\/\\\_______\/\\\_ 
        _______\///________\///________\///__\///______________\///////////_______\/////_____________\/////////__\///________\///__

*/

contract TapOFTReceiver is BaseTapOFTv2, IOAppComposer {
    using OFTMsgCodec for bytes;
    using OFTMsgCodec for bytes32;

    constructor(
        address _endpoint,
        address _owner
    ) BaseTapOFTv2(_endpoint, _owner) {}

    /// @dev Triggered if the address of the composer doesn't match current contract.
    error InvalidComposer(address composer);
    error InsufficientAllowance(address owner, uint256 amount); // See `this.__internalTransferWithAllowance()`

    /// @dev Compose received.
    event ComposeReceived(
        uint16 indexed msgType,
        bytes32 indexed guid,
        bytes composeMsg
    );

    /// @dev twTAP lock operation received.
    event LockTwTapReceived(
        address indexed user,
        uint96 duration,
        uint256 amount
    );

    /**
     * @dev Slightly modified version of the OFT _lzReceive() operation.
     * The composed message is sent to `address(this)` instead of `toAddress`.
     * @dev Internal function to handle the receive on the LayerZero endpoint.
     * @param _origin The origin information.
     *  - srcEid: The source chain endpoint ID.
     *  - sender: The sender address from the src chain.
     *  - nonce: The nonce of the LayerZero message.
     * @param _guid The unique identifier for the received LayerZero message.
     * @param _message The encoded message.
     * @dev _executor The address of the executor.
     * @dev _extraData Additional data.
     */
    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message,
        address /*_executor*/, // @dev unused in the default implementation.
        bytes calldata /*_extraData*/ // @dev unused in the default implementation.
    ) internal virtual override {
        // @dev The src sending chain doesn't know the address length on this chain (potentially non-evm)
        // Thus everything is bytes32() encoded in flight.
        address toAddress = _message.sendTo().bytes32ToAddress();
        // @dev Convert the amount to credit into local decimals.
        uint256 amountToCreditLD = _toLD(_message.amountSD());
        // @dev Credit the amount to the recipient and return the ACTUAL amount the recipient received in local decimals
        uint256 amountReceivedLD = _credit(
            toAddress,
            amountToCreditLD,
            _origin.srcEid
        );

        if (_message.isComposed()) {
            // @dev Stores the lzCompose payload that will be executed in a separate tx.
            // Standardizes functionality for executing arbitrary contract invocation on some non-evm chains.
            // @dev The off-chain executor will listen and process the msg based on the src-chain-callers compose options passed.
            // @dev The index is used when a OApp needs to compose multiple msgs on lzReceive.
            // For default OFT implementation there is only 1 compose msg per lzReceive, thus its always 0.
            endpoint.sendCompose(
                address(this), // Updated from default `toAddress`
                _guid,
                0 /* the index of the composed message*/,
                _message.composeMsg()
            );
        }

        emit OFTReceived(_guid, toAddress, amountToCreditLD, amountReceivedLD);
    }

    // TODO - SANITIZE MSG TYPE
    /**
     * @notice Composes a LayerZero message from an OApp.
     * @dev The message comes in form: [msgType, composeMsg].
     * @param _from The address initiating the composition, typically the OApp where the lzReceive was called.
     * @param _guid The unique identifier for the corresponding LayerZero src/dst tx.
     * @param _message The composed message payload in bytes. NOT necessarily the same payload passed via lzReceive.
     */
    function lzCompose(
        address _from,
        bytes32 _guid,
        bytes calldata _message,
        address, // _executor The address of the executor for the composed message.
        bytes calldata // _extraData Additional arbitrary data in bytes passed by the entity who executes the lzCompose.
    ) external payable override {
        // Validate the from.
        if (_from != address(this)) {
            revert InvalidComposer(_from);
        }

        // Decode LZ compose message
        (address composeSender_, bytes memory oftComposeMsg_) = TapOFTMsgCoder
            .decodeLzComposeMsg(_message);

        // Decode OFT compose message
        (
            uint16 msgType_,
            ,
            uint16 msgIndex_,
            bytes memory tapComposeMsg_,
            bytes memory nextMsg_
        ) = TapOFTMsgCoder.decodeTapComposeMsg(oftComposeMsg_);

        if (msgType_ == PT_LOCK_TWTAP) {
            _lockTwTapPositionReceiver(tapComposeMsg_);
        } else if (msgType_ == PT_APPROVALS) {
            _erc20PermitApprovalReceiver(tapComposeMsg_);
        } else {
            revert InvalidMsgType(msgType_);
        }

        emit ComposeReceived(msgType_, _guid, _message);

        if (nextMsg_.length > 0) {
            endpoint.sendCompose(
                address(this),
                _guid,
                msgIndex_ + 1, // Increment the index
                abi.encodePacked(
                    OFTMsgCodec.addressToBytes32(composeSender_),
                    nextMsg_
                ) // Re encode the compose msg with the composeSender
            );
        }
    }

    // ********************* //
    // ***** RECEIVERS ***** //
    // ********************* //

    /**
     *
     * @param _data The call data containing info about the lock.
     *          - user::address: Address of the user to lock the TAP for.
     *          - duration::uint96: Amount of time to lock for.
     *          - amount::uint256: Amount of TAP to lock.
     */

    // TODO sanitize the user to use approve on behalf of him
    function _lockTwTapPositionReceiver(bytes memory _data) internal virtual {
        LockTwTapPositionMsg memory lockTwTapPositionMsg_ = TapOFTMsgCoder
            .decodeLockTwpTapDstMsg(_data);

        /// @dev xChain user needs to have approved dst TapOFTv2 in a previous composedMsg.
        _internalTransferWithAllowance(
            lockTwTapPositionMsg_.user,
            lockTwTapPositionMsg_.amount
        );

        _approve(address(this), address(twTap), lockTwTapPositionMsg_.amount);
        twTap.participate(
            lockTwTapPositionMsg_.user,
            lockTwTapPositionMsg_.amount,
            lockTwTapPositionMsg_.duration
        );

        emit LockTwTapReceived(
            lockTwTapPositionMsg_.user,
            lockTwTapPositionMsg_.duration,
            lockTwTapPositionMsg_.amount
        );
    }

    /**
     * @dev Performs a transfer with an allowance check and consumption. Can only transfer to this address.
     * Use with caution. Check next operations to see where the tokens are sent.
     * @param _from The account to transfer from.
     * @param _amount The amount to transfer
     */
    function _internalTransferWithAllowance(
        address _from,
        uint256 _amount
    ) internal {
        if (allowance(_from, address(this)) < _amount) {
            revert InsufficientAllowance(_from, _amount);
        }
        _spendAllowance(_from, address(this), _amount);
        _transfer(_from, address(this), _amount);
    }

    /**
     * @notice Approves tokens via permit.
     * @param _data The call data containing info about the approvals. See `TapOFTSender.buildPermitApprovalMsg()`.
     *      - token::address: Address of the token to approve.
     *      - owner::address: Address of the owner of the tokens.
     *      - spender::address: Address of the spender.
     *      - value::uint256: Amount of tokens to approve.
     *      - deadline::uint256: Deadline for the approval.
     *      - v::uint8: v value of the signature.
     *      - r::bytes32: r value of the signature.
     *      - s::bytes32: s value of the signature.
     */
    function _erc20PermitApprovalReceiver(bytes memory _data) internal virtual {
        ERC20PermitApprovalMsg[] memory approvals = TapOFTMsgCoder
            .decodeArrayOfERC20PermitApprovalMsg(_data);

        tapOFTExtExec.erc20PermitApproval(approvals);
    }
}
