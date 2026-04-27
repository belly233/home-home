"use client"
import { useState } from "react";

export default function Page() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: 40 }}>
      <h1>点击次数：{count}</h1>
      <button onClick={() => setCount(count + 1)}>
        点我
      </button>
    </div>
  );
}
