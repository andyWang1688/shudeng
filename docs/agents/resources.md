# 构建、磁盘与临时资源

构建使用 scripts/build-ios-rn.sh [Debug|Release]；历史清理使用 scripts/prune-project-artifacts.sh。参数与当前行为先读脚本，以下为必须保留的边界。

## 构建合同

- 可用空间不足 **30 GiB** 禁止新增大型构建；固定复用 .build/rn-ios/derived，不散落 DerivedData 或把持久依赖放入系统临时目录。
- 默认 .build 总量上限 20 GiB、artifact 上限 3 GiB，模拟器与真机分别按配置只留最新 app。临时目录通过 EXIT/INT/TERM 回收；失败或未完成产物不晋级 artifact。
- 修改构建/清理脚本时，验证连续两轮与失败清理，确认空间不随轮数增长；中断路径共享 trap 时检查该接缝。过去的验收数字不能当本次通过证据。

默认构建模拟器；真机构建使用 `IOS_DEVICE_UDID=<UDID> IOS_DEVELOPMENT_TEAM=<TEAM> KEEP_ARTIFACT=1 scripts/build-ios-rn.sh Release`，需要 Xcode 已登录对应开发团队。脚本使用设备目标与自动签名，产物名为 `Release-iphoneos-<时间戳>/app.app`；默认模拟器产物名保持不变。`latest.app` 指向最近保留的产物，安装前仍需核对目标平台、签名和授权有效期。开发签名安装不等于正式分发，不能承诺长期可启动。

手机未连接时，可用 `IOS_DEVICE_BUILD=1 IOS_DEVELOPMENT_TEAM=<TEAM> scripts/build-ios-rn.sh Release` 为通用 iPhone 目标构建，不安装。真机构建会更新应用资源签名，签名校验通过后才保留产物；安装前还要验证描述文件包含目标手机且未过期。指定 `IOS_DEVICE_UDID` 时仍使用该设备作为构建目标。

## 清理合同

1. 一次性脚本、调试日志、临时截图与导出集中在任务专属目录，复用现有依赖和环境。
2. 删除前确认归属、用途及进程占用；仅删本任务已不需要的临时文件或脚本明确允许的可再生产物，未知文件跳过并说明。
3. 保留正式源码、未提交工作、书籍、阅读/笔记/问答数据库、密钥、当前连接配置与其他会话资源；重复 Shudeng.app 备份至少留最新一份。
4. 数据恢复备份、工作树快照和会话历史属于恢复资料，说明影响并取得对应清理授权后再删；不当作普通缓存。
5. 清理后复查路径，报告释放空间与保留项；不为清理额外生成无必要的报告或备份。

历史构建与空间采样保留在[原记录](../archive/planning/disk-management-2026-11-02.md)，不作为当前机器状态。
