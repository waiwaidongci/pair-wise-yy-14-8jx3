import "./styles.css";

const project = {
  "sourceNo": 8,
  "id": "hxyfront-62013",
  "port": 62013,
  "title": "木结构榫卯构件测绘",
  "domain": "古建木结构",
  "prompt": "开发一个古建筑木结构榫卯构件测绘前端项目，测绘人员可以录入建筑名称、构件编号、木材种类、榫卯类型、截面尺寸、病害位置、变形情况和修缮建议。页面需要有构件清单、榫卯类型筛选、尺寸记录表、病害标记图和单栋建筑的构件关系视图。",
  "palette": [
    "#854d0e",
    "#475569",
    "#0f766e"
  ],
  "metrics": [
    "构件数量",
    "病害点",
    "榫卯类型",
    "待修缮"
  ],
  "filters": [
    "燕尾榫",
    "透榫",
    "半榫",
    "箍头榫"
  ],
  "fields": [
    "建筑名称",
    "构件编号",
    "木材种类",
    "榫卯类型",
    "截面尺寸",
    "修缮建议"
  ],
  "records": [
    [
      "梁架A-03",
      "透榫",
      "截面180x240mm",
      "端部开裂"
    ],
    [
      "柱网C-12",
      "楠木",
      "柱脚糟朽",
      "建议局部墩接"
    ],
    [
      "斗拱D-07",
      "半榫",
      "轻微变形",
      "继续监测"
    ]
  ]
};

function App() {
  return (
    <main className="app">
      <section className="hero">
        <p>{project.id} · 源提示词{project.sourceNo} · Port {project.port}</p>
        <h1>{project.title}</h1>
        <span>{project.prompt}</span>
      </section>

      <section className="metrics">
        {project.metrics.map((metric: string, index: number) => (
          <article key={metric}>
            <small>{metric}</small>
            <strong>{[28, 6, 14, 91][index] ?? 10}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>{project.domain}分类</h2>
          <div className="chips">
            {project.filters.map((item: string) => (
              <button key={item}>{item}</button>
            ))}
          </div>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>专业字段</p>
              <h2>新增记录</h2>
            </div>
            <button className="primary">保存记录</button>
          </div>
          <div className="field-grid">
            {project.fields.map((field: string) => (
              <label key={field}>
                <span>{field}</span>
                <input placeholder={"填写" + field} />
              </label>
            ))}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>近期记录</p>
            <h2>工作台摘要</h2>
          </div>
          <button>导出CSV</button>
        </div>
        <div className="records">
          {project.records.map((record: string[], index: number) => (
            <article key={record.join("-")}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div>
                <h3>{record[0]}</h3>
                <p>{record.slice(1).join(" · ")}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
