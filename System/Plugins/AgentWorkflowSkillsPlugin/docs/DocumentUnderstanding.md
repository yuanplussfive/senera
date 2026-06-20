# DocumentUnderstandingSkill

## 简述

用于上传文件、文档探测、预览、切片、图片识别和按需读取。目标是先登记文件事实，再按任务选择文本、结构或视觉路径。

## 何时使用

当用户上传文件，或讨论 PDF、docx、ppt、excel、图片、截图、MIME、预览、chunks、artifact 读取时使用。

## 不要使用的情况

没有上传 URI、文件路径或文档处理任务时不要激活。代码库搜索问题应使用工作区调查技能。

## 工作流

1. 上传阶段只保存文件和生成 uploadUri，不在上传接口里做重处理。
2. 解析阶段由文档工具根据 uploadUri 探测文件事实：名称、MIME、容器格式、文本可用性和可选预览。
3. 用户要求分工处理文档结构和视觉路径时，先用 AgentDelegateTool 展开 DocumentUnderstandingWorkflow。
4. 文本型或 Office/PDF 文件优先生成 markdownPreview 作为主投影；textPreview 和 chunks 落 artifact，按需读取。
5. 图片、截图或视觉密集型 PDF 页面，使用视觉工具回答具体问题，不引入不必要的重型本地图像依赖。
6. 模型上下文只放主预览和证据引用，不直接塞全文 chunks。
7. 当用户追问细节时，通过 artifact 读取或文档工具按需补充，而不是重新上传或重复解析。

## 证据标准

回答文件内容前需要有 document 或 image evidence。不能仅凭文件名、扩展名或 uploadUri 猜内容。

## 完成标准

输出应说明文件类型、可用内容形态、当前预览能回答什么、需要进一步读取什么 artifact 或调用什么视觉任务。
