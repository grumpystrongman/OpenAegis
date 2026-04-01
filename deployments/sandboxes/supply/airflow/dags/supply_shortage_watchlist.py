from airflow import DAG
from airflow.operators.bash import BashOperator
from datetime import datetime

with DAG(
    dag_id="supply_shortage_watchlist",
    start_date=datetime(2026, 1, 1),
    schedule="@hourly",
    catchup=False,
    tags=["openaegis", "supply"],
) as dag:
    BashOperator(
        task_id="refresh_shortage_watchlist",
        bash_command="echo 'refreshing shortage watchlist for sandbox demo'",
    )
