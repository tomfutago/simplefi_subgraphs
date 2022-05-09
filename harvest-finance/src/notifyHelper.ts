import { NotifyPoolsCall } from "../generated/NotifyHelper/NotifyHelper";
import { createFakeEventFromCall, getOrCreateRewardPool, getOrCreateVault } from "./harvestUtils";
import { RewardPool as RewardPoolContract } from "../generated/templates/RewardPool/RewardPool";

export function handleNotifyPools(call: NotifyPoolsCall): void {
  let rewardPoolAddresses = call.inputs.pools;
  for (let i = 0; i < rewardPoolAddresses.length; i++) {
    // get vault
    let rewardPoolContract = RewardPoolContract.bind(rewardPoolAddresses[i]);
    let vaultAddress = rewardPoolContract.lpToken();
    getOrCreateVault(createFakeEventFromCall(call), vaultAddress);

    // create reward pool if it doesn't exist
    getOrCreateRewardPool(createFakeEventFromCall(call), rewardPoolAddresses[i].toHexString());
  }
}