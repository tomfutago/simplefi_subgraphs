import { near, BigInt, log, json, JSONValueKind, Bytes, JSONValue } from "@graphprotocol/graph-ts"

/**
pub fn new(owner_id: ValidAccountId, exchange_fee: u32, referral_fee: u32) -> Self
 */
export function initRefV2(
  functionCall: near.FunctionCallAction, 
  receipt: near.ActionReceipt, 
  block: near.Block, 
  outcome: near.ExecutionOutcome
): void {
  const args = json.fromBytes(functionCall.args).toObject();
  const ownerId = (args.get("owner_id") as JSONValue).toString();
  const exchangeFee = (args.get("exchange_fee") as JSONValue).toBigInt();
  const referralFee = (args.get("referral_fee") as JSONValue).toBigInt();
  log.warning("Initalize Ref V2 contract with -> ownerId: {}, exchangeFee: {}, referralFee: {}", [
    ownerId,
    exchangeFee.toString(),
    referralFee.toString()
  ]);
}

/**
add_simple_pool(&mut self, tokens: Vec<ValidAccountId>, fee: u32) -> u64
 */ 
export function addSimplePool(
  functionCall: near.FunctionCallAction, 
  receipt: near.ActionReceipt, 
  block: near.Block, 
  outcome: near.ExecutionOutcome
): void {

}

/**
add_stable_swap_pool(
  &mut self,
  tokens: Vec<ValidAccountId>,
  decimals: Vec<u8>,
  fee: u32,
  amp_factor: u64,
) -> u64
 */
export function addStableSwapPool(
  functionCall: near.FunctionCallAction, 
  receipt: near.ActionReceipt, 
  block: near.Block, 
  outcome: near.ExecutionOutcome
): void {

}

/**
execute_actions(
  &mut self,
  actions: Vec<Action>,
  referral_id: Option<ValidAccountId>,
) -> ActionResult
 */
export function executeActions(
  functionCall: near.FunctionCallAction, 
  receipt: near.ActionReceipt, 
  block: near.Block, 
  outcome: near.ExecutionOutcome
): void {

}

/**
add_liquidity(
  &mut self,
  pool_id: u64,
  amounts: Vec<U128>,
  min_amounts: Option<Vec<U128>>,
)
 */
export function addLiquidity(
  functionCall: near.FunctionCallAction, 
  receipt: near.ActionReceipt, 
  block: near.Block, 
  outcome: near.ExecutionOutcome
): void {

}

/**
add_stable_liquidity(
  &mut self,
  pool_id: u64,
  amounts: Vec<U128>,
  min_shares: U128,
) -> U128
 */
export function addStableLiquidity(
  functionCall: near.FunctionCallAction, 
  receipt: near.ActionReceipt, 
  block: near.Block, 
  outcome: near.ExecutionOutcome
): void {

}

/**
remove_liquidity(&mut self, pool_id: u64, shares: U128, min_amounts: Vec<U128>)
 */
export function removeLiquidity(
  functionCall: near.FunctionCallAction, 
  receipt: near.ActionReceipt, 
  block: near.Block, 
  outcome: near.ExecutionOutcome
): void {

}

/**
remove_liquidity_by_tokens(
  &mut self, pool_id: u64, 
  amounts: Vec<U128>, 
  max_burn_shares: U128
) -> U128
 */
export function removeLiquidityByTokens(
  functionCall: near.FunctionCallAction, 
  receipt: near.ActionReceipt, 
  block: near.Block, 
  outcome: near.ExecutionOutcome
): void {

}

/**
swap(&mut self, actions: Vec<SwapAction>, referral_id: Option<ValidAccountId>) -> U128
 */
export function swap(
  functionCall: near.FunctionCallAction, 
  receipt: near.ActionReceipt, 
  block: near.Block, 
  outcome: near.ExecutionOutcome
): void {

}